/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var domino = require('domino');
var validUrl = require('valid-url');
var url = require('url');

var DISCOVER_IMAGES_MAX  = 5;

/**
 * Get all metadata from an HTML document. This includes:
 * - URL
 * - title
 * - Metadata specified in <meta> tags, including OpenGraph data
 * - Links specified in <link> tags (short, canonical, preview images, alternative)
 * - Content that can be found in the page content that we consider useful metadata
 * - Microformats
 *
 * @param {Document} document - Document to extract data from.
 * @param {Element} [target] - Optional element to restrict microformats lookup to.
 * @returns {Object} Object containing the various metadata, normalized to
 *                   merge some common alternative names for metadata.
 */
function getData(pageBody, documentURI) {

  var window = domino.createWindow(pageBody);
  var document = window.document;

  var result = {
    url: _validateURL(documentURI, documentURI),
    title: document.title,
    previews: []
  };

  _getMetaData(document, documentURI, result);
  _getLinkData(document, documentURI, result);
  _getPageData(document, documentURI, result);

  return result;
}

/**
 * Get metadata as defined in <meta> tags.
 * This adds properties to an existing result object.
 *
 * @param {Document} document - Document to extract data from.
 * @param {Object}  result - Existing result object to add properties to.
 */
function _getMetaData(document, baseUrl, result) {
  // Query for standardized meta data.
  var elements = document.querySelectorAll("head > meta[property], head > meta[name]");
  if (elements.length < 1) {
    return;
  }

  for (var element in elements) {
    if (element === "item") {
      continue;
    }
    var value = elements[element].getAttribute("content");
    if (!value) {
      continue;
    }
    value = decodeURIComponent(value.trim());

    var key = elements[element].getAttribute("property") || elements[element].getAttribute("name");
    if (!key) {
      continue;
    }

    result[key] = value;
    var url;

    switch (key) {
      case "title":
      case "og:title": {
        // Only set the title if one hasn't already been obtained (e.g. from the
        // document title element).
        if (!result.title) {
          result.title = value;
        }
        break;
      }

      case "description":
      case "og:description": {
        result.description = value;
        break;
      }

      case "og:site_name": {
        result.siteName = value;
        break;
      }

      case "medium":
      case "og:type": {
        result.medium = value;
        break;
      }

      case "og:video": {
        url = _validateURL(baseUrl, value);
        if (url) {
          result.source = url;
        }
        break;
      }

      case "og:url": {
        url = _validateURL(baseUrl, value);
        if (url) {
          result.url = url;
        }
        break;
      }

      case "og:image": {
        url = _validateURL(baseUrl, value);
        if (url) {
          result.previews.push(url);
        }
        break;
      }
    }
  }
}

/**
 * Get document element HREF attribute defined in tags.
 * This returns the HREF URL string.
 *
 * @param {Element} element - Document element to get HREF attribute from.
 * @param {String} baseUrl - URL all relative links and sites are based on.
 */
function _getAttr(element, attr, baseUrl) {
  // console.log("element", element);
  var uri;
  // console.log("_getLinkData ATTROBJ element._attrsByQName.href",
  //   element._attrsByQName.href);
  try {
    if (element._attrsByQName[attr] && element._attrsByQName[attr].data) {
      uri = element._attrsByQName[attr].data;
      // var uri = element.getAttribute("href");
      if (!uri) {
        return false;
      }
    } else {
      return false;
    }

  } catch(ex) {
    return false;
  }
  uri = _validateURL(baseUrl, decodeURIComponent(uri.trim()));
  return uri;
}

/**
 * Get metadata as defined in <link> tags.
 * This adds properties to an existing result object.
 *
 * @param {Document} document - Document to extract data from.
 * @param {String} baseUrl - URL all relative links and sites are based on.
 * @param {Object}  result - Existing result object to add properties to.
 */
function _getLinkData(document, baseUrl, result) {
  var elements = document.querySelectorAll("head > link[rel], head > link[id]");

  for (var element in elements) {
    if (element === "item") {
      continue;
    }

    var key = elements[element].getAttribute("rel") || elements[element].getAttribute("id");
    if (!key) {
      continue;
    }

    switch (key) {
      case "shorturl":
      case "shortlink": {
        result.shortUrl = _getAttr(elements[element],  "href",baseUrl);
        break;
      }

      case "canonicalurl":
      case "canonical": {
        result.url = _getAttr(elements[element], "href", baseUrl);
        break;
      }

      case "image_src": {
        result.previews.push(_getAttr(elements[element], "href", baseUrl));
        break;
      }

      case "alternate": {
        // Expressly for oembed support but we're liberal here and will let
        // other alternate links through. oembed defines an href, supplied by
        // the site, where you can fetch additional meta data about a page.
        // We'll let the client fetch the oembed data themselves, but they
        // need the data from this link.
        if (!result.alternate) {
          result.alternate = [];
        }

        result.alternate.push({
          // TODO - custom extraction methods
          type: _getAttr(elements[element], "type", baseUrl),
          href: _getAttr(elements[element], "href", baseUrl),
          title: _getAttr(elements[element], "title", baseUrl)
        });
      }
    }
  }
}

/**
 * Scrape thought the page content for additional content that may be used to
 * suppliment explicitly defined metadata. This includes:
 * - First few images, when no preview image metadata is explicitly defined.
 *
 * This adds properties to an existing result object.
 *
 * @param {Document} document - Document to extract data from.
 * @param {Object}  result - Existing result object to add properties to.
 */
function _getPageData(document, baseUrl, result) {
  if (result.previews.length < 1) {
    result.previews = _getImageUrls(document, baseUrl);
  }
}

/**
 * Find the first few images in a document, for use as preview images.
 * Will return upto DISCOVER_IMAGES_MAX number of images.
 *
 * @note This is not very clever. It does not (yet) check if any of the
 *       images may be appropriate as a preview image.
 *
 * @param {Document} document - Document to extract data from.
 * @return {[string]} Array of URLs.
 */
function _getImageUrls(document, baseUrl) {
  var result = [];
  var elements = document.querySelectorAll("img");

  for (var element in elements) {
    var src = elements[element].getAttribute("src");
    if (src) {
      result.push(_validateURL(baseUrl, decodeURIComponent(src)));   //, UnescapeService.unescape(src)

      // We don't want a billion images.
      if (result.length > DISCOVER_IMAGES_MAX) {
        break;
      }
    }
  }

  return result;
}

/**
 * Validate a URL. This involves resolving the URL if it's relative to the
 * document location, ensuring it's using an expected scheme, and stripping
 * the userPass portion of the URL.
 *
 * @param {Document} document - Document to use as the root location for a relative URL.
 * @param {string} url - URL to validate.
 * @return {string} Result URL.
 */
function _validateURL(baseUrl, uri) {
  var validURL;

  try {
    validURL = url.resolve(baseUrl, uri);

    if (validUrl.isUri(validURL)){
      return validURL;
    } else {
      return null;
    }
  } catch (ex) {
    // URL may throw, default to false;
    console.log("URL not valid error", ex);
    return null;
  }
}

module.exports = {
  getData: getData
};

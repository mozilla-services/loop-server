/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

/**
 * <locale>/legal/terms and <locale>/legal/privacy
 * Translation done by fetching appropriate template for language.
 * If language is not found, fall back to en-US.
 *
 * Either full HTML or a partial can be requested. Partials are
 * requested by the front end to request translated documents and
 * insert them into the DOM. Full HTML is used whenever a user
 * browses to one of the pages directly.
 *
 * Partials are requested by setting the `Accepts` header to `text/partial`
 * HTML is returned if `Accepts` is `text/html`
 */

var fs = require('fs');
var path = require('path');
var conf = require('./config').conf;
var format = require('util').format;

var PAGE_TEMPLATE_DIRECTORY = path.join(conf.get('pageTemplateRoot'),
                                        'dist');
var TOS_ROOT_PATH = path.join(PAGE_TEMPLATE_DIRECTORY, 'terms');
var PP_ROOT_PATH = path.join(PAGE_TEMPLATE_DIRECTORY, 'privacy');


module.exports = function verRoute (app, logError, i18n) {
  var DEFAULT_LANG = conf.get('i18n.defaultLang');
  var DEFAULT_LOCALE = i18n.localeFrom(DEFAULT_LANG);

  var route = {};
  route.method = 'get';

  // Match (allow for optional trailing slash):
  // * /legal/terms
  // * /<locale>/legal/terms
  // * /legal/privacy
  // * /<locale>/legal/privacy
  route.path = /^\/(?:([a-zA-Z\-\_]*)\/)?legal\/(terms|privacy)(?:\/)?$/;

  function getRoot(type) {
    return type === 'terms' ? TOS_ROOT_PATH : PP_ROOT_PATH;
  }

  var templateCache = {};
  function getTemplate(type, lang, callback) {
    // Filenames are normalized to locale, not language.
    var locale = i18n.localeFrom(lang);
    var templatePath = path.join(getRoot(type), locale + '.html');

    // cache the promises to avoid multiple concurrent checks for
    // the same template due to async calls to the file system.
    if (templateCache[templatePath]) {
      callback(null, templateCache[templatePath]);
      return;
    }

    fs.exists(templatePath, function (exists) {
      if (! exists) {
        var bestLang = i18n.bestLanguage(i18n.parseAcceptLanguage(lang));

        if (locale === DEFAULT_LOCALE) {
          var err = new Error(type + ' missing `' + DEFAULT_LOCALE +
                              '` template: ' + templatePath);
          callback(err);
          return;
        } else if (lang !== bestLang) {
          logError(
            new Error(format('`%s` does not exist, trying next best `%s`',
                             lang, bestLang))
          );
          callback(null, getTemplate(type, bestLang));
          return;
        }

        templateCache[templatePath] = null;
        callback(null, null);
        return;
      }

      fs.readFile(templatePath, 'utf8', function(err, data) {
        if (err) {
          callback(err);
          return;
        }

        templateCache[templatePath] = data;
        callback(null, data);
      });
    });
  }

  route.process = function (req, res) {
    var lang = req.params[0];
    var page = req.params[1];

    if (! lang) {
      // abide should put a lang on the request, if not, use the default.
      return res.redirect(getRedirectURL(req.lang || DEFAULT_LANG, page));
    }

    getTemplate(page, lang, function (err, template) {
      if (err) {
        logError(err);
        return res.send(500, 'uh oh: ' + String(err));
      }
      if (! template) {
        logError(
          new Error(format('%s->`%s` does not exist, redirecting to `%s`',
                           page, lang, DEFAULT_LANG))
        );
        return res.redirect(getRedirectURL(DEFAULT_LANG, page));
      }

      res.format({
        'text/partial': function () {
          res.send(template);
        },
        'text/html': function () {
          res.render(page, {
            body: template,
            lang: req.lang,
            lang_dir: req.lang_dir
          });
        }
      });
    });
  };

  function getRedirectURL(lang, page) {
    // lang at this point may use `_` as the separator. Abide matches
    // URLs with `-`. Use i18n.languageFrom to do any conversions and
    // ensure abide is able to match the language.
    return i18n.languageFrom(lang) + '/legal/' + page;
  }

  app[route.method](route.path, route.process);
};

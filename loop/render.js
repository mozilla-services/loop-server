"use strict";

/**
 * Module dependencies
 */

var system = require("system");

// arguments
var params = JSON.parse(system.args[1]);
var page = require("webpage").create();

// features
var windowSize = params.window;
var disable = params.disable;
var crop = params.crop;
var zoom = params.zoom;

if (windowSize) {
  page.viewportSize = windowSize;
}

if (crop) {
  page.clipRect = {
    top: crop.y,
    left: crop.x,
    width: crop.width,
    height: crop.height
  };
} else {
  page.clipRect = {
    top: 0,
    left: 0,
    width: windowSize.width,
    height: windowSize.height
  };
}

if (zoom) {
  page.zoomFactor = zoom.factor;
}

if (disable) {
  if (disable.javascript) {
    page.settings.javascriptEnabled = false;
  }

  if (disable.images) {
    page.settings.loadImages = false;
  }
}

var url = decodeURIComponent(params.url);
var window;
page.open(url, function () {
  var system = require("system");
  window.setTimeout(function () {
    system.stdout.write("data:image/png;base64," + page.renderBase64('PNG'));
    this.phantom.exit();
  }, 200);
});

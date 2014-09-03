module.exports = function (grunt) {
  "use strict";

  require("load-grunt-tasks")(grunt);

  grunt.initConfig({
    "APP": {
      "CODE_DIRS": "{,config/**/,loop/**/,test/**/}",
      "COPYRIGHT": "This Source Code Form is subject to the terms of the Mozilla Public"
    },
    "pkg": require("./package.json"),

    "copyright": {
      "options": {
        "pattern": "<%= APP.COPYRIGHT %>"
      },
      "src": "<%= eslint.src %>"
    },

    "eslint": {
      "src": "<%= APP.CODE_DIRS %>*.js"
    },

    "jsonlint": {
      "src": "<%= APP.CODE_DIRS %>*.json"
    },

    "shell": {
      "shrinkwrap": {
        "command": "npm shrinkwrap --dev"
      }
    },

    "todo": {
      "src": "<%= eslint.src %>"
    },

    "validate-shrinkwrap": {
    }
  });

  grunt.registerTask("lint", ["eslint", "jsonlint"]);
  grunt.registerTask("audit-shrinkwrap", ["shell:shrinkwrap", "validate-shrinkwrap"]);
  grunt.registerTask("default", ["lint", "copyright"]);
};

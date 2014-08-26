module.exports = function (grunt) {
  "use strict";

  require("load-grunt-tasks")(grunt);

  grunt.initConfig({
    "APP": {
      "CODE_DIRS": "{,config/**/,loop/**/,test/**/}"
    },
    "pkg": require("./package.json"),

    "copyright": {
      "options": {
        "pattern": "This Source Code Form is subject to the terms of the Mozilla Public"
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
      "outdated": {
        "command": "npm outdated --depth 0"
      },
      "shrinkwrap": {
        "command": "npm shrinkwrap --dev"
      },
      "rm-shrinkwrap": {
        "command": "rm npm-shrinkwrap.json"
      }
    },

    "todo": {
      "options": {
        "marks": [
          {
            "name": 'FIX',
            "pattern": /FIXME/,
            "color": 'red'
          },
          {
            "name": 'TODO',
            "pattern": /TODO/,
            "color": 'yellow'
          },
          {
            "name": 'NOTE',
            "pattern": /NOTE/,
            "color": 'blue'
          }, {
            "name": 'XXX',
            "pattern": /XXX/,
            "color": 'yellow'
          }, {
            "name": 'HACK',
            "pattern": /HACK/,
            "color": 'red'
          }
        ]
      },
      "src": [
        "<%= eslint.src %>",
        "!Gruntfile.js"
      ]
    },

    "validate-shrinkwrap": {
    }
  });

  grunt.registerTask("lint", ["eslint", "jsonlint"]);
  grunt.registerTask("do-shrinkwrap", ["shell:shrinkwrap", "validate-shrinkwrap", "shell:rm-shrinkwrap"]);
  grunt.registerTask("audit-shrinkwrap", ["do-shrinkwrap", "shell:outdated"]);
  grunt.registerTask("default", ["lint", "copyright"]);
};

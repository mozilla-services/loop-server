#!/bin/bash
node expiration.js | tail -n+3 | cut -f 1,2 | perl -lane 'print $F[0], "\t", $F[1], "\t", "=" x ($F[1] / 3 + 1)'

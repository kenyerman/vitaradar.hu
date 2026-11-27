#!/bin/sh
# Refreshes __/auth/ from Firebase: Google sign-in's helper pages, served from vitaradar.hu itself for the iPhone app
# (js/firebase.js says why). They are Firebase's own files, unchanged; only the pages get .html, so that GitHub Pages
# serves /__/auth/handler and /__/auth/iframe (the addresses Firebase's SDK asks for) from handler.html and iframe.html.
# Firebase asks for its copies to be kept current ("Best practices for using signInWithRedirect…", option 4):
# .github/workflows/auth-helper.yml runs this every week and commits what changed. By hand: sh tools/auth-helper.sh
set -eu
cd "$(dirname "$0")/.."
SRC=https://parlament-factcheck.firebaseapp.com/__/auth
mkdir -p __/auth
get() { curl -fsS --retry 3 -o "__/auth/$2.tmp" "$SRC/$1" && mv "__/auth/$2.tmp" "__/auth/$2"; }
get handler handler.html
get iframe iframe.html
get handler.js handler.js
get iframe.js iframe.js
get experiments.js experiments.js

#!/bin/sh
set -e
cd "$(dirname "$0")"
npm install
npm run setup:media
npm run dev

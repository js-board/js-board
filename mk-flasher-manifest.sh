#! /bin/bash -e
GIT_REF=$1
DATE=$(TZ=America/Los_Angeles date +%Y.%j)
BR=$(git rev-parse --abbrev-ref HEAD)
if [[ $GIT_REF == /ref/tags/v* ]]; then
  DIR=release
  NAME=js-board-$BR # release tag
elif [[ $GIT_REF == /ref/heads/main ]]; then
  DIR=main
  NAME=js-board-$DATE # main branch, just use date
else
  DIR=$BR
  NAME=js-board-$BR-$DATE # branch push, append date
fi

mkdir $DIR
if [[ "$2" == v* ]]; then
cat <<EOF >$DIR/manifest-flasher.json
{
  "name": "JS-Board",
  "version": "${DIR}",
  "new_install_prompt_erase": true,
  "builds": [{
    "chipFamily": "ESP32",
    "parts": [
      { "path": "bootloader.bin", "offset": 4096 },
      { "path": "partition-table.bin", "offset": 32768 },
      { "path": "xs_esp32.bin", "offset": 65536 }
    ]
  }]
}
EOF

cp build/bin/*.bin $DIR
cp -a types $DIR
cp manifest-js-board.json $DIR

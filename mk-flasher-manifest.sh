#! /bin/bash -e
GIT_REF=$1
DATE=$(TZ=America/Los_Angeles date +%Y.%j)
BR=$(git rev-parse --abbrev-ref HEAD)
if [[ $GIT_REF == /ref/tags/v* ]]; then
  DIR=dist/release/$BR
  NAME=JS-Board
  VERS=$BR # release tag
elif [[ $GIT_REF == /ref/heads/main ]]; then
  DIR=dist/main/$DATE
  NAME=JS-Board-dev
  VERS=$DATE
else
  DIR=dist/$BR/$DATE
  NAME=JS-Board-dev-$BR
  VERS=$DATE
fi

mkdir -p $DIR
cat <<EOF >$DIR/manifest-flasher.json
{
  "name": "${NAME}",
  "version": "${VERS}",
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

cp $(find build/bin/$TARGET -name \*.bin) $DIR
cp -a typings $DIR
cp manifest_js-board.json $DIR
tar zcf $DIR/types.tgz $DIR/types

echo "Created $DIR:"
ls -ls $DIR

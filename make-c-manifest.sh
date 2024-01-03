#! /bin/bash -e
MODULES=$MODDABLE/modules
MM=$(find $MODULES -name manifest\*.json | grep -Ev '/(lin|win|mac|pico|nrf52|piu|commodetto)/')
EXCL=".*(bmp280|base/sleep|tinyint|rmt|pulsecount|servo|audioin|ili9341|ili9341_p8|si7021|xpt2046|touchpad|ssd1351|ls013b4dn04|lpm013m126a).*"

#create array of natives
set -a natives
for m in $MM; do
  d=${m%manifest*}
  c=$(find $d -name '*.c')
  if [ -n "$c" ]; then
    [[ $c =~ $EXCL ]] && continue
    natives+=($m)
  fi
done

# create manifest
echo '{ "include": [' > manifest-natives.json
for n in ${natives[@]}; do
  echo "  \"${n/$MODULES\//\$(MODULES)/}\"," >> manifest-natives.json
done
echo "  \"\$(MODDABLE)/examples/manifest_base.json\"" >> manifest-natives.json
echo ']}' >> manifest-natives.json

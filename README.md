# JS-Board Firmware

This repo contains the source code for the JavaScript Embedded Board Manager (JS-Board) firmware.
Please refer to the [main project page](https://js-board.github.io/) and to the
[documentation](https://js-board.github.io/docs) for more information.

## Notes

### DEBUGGER_SPEED

- this sets the speed at which the Moddable SDK initializes the serial port
- the default value is 921600
- the esp-idf bootload most likely inits to 115200 (dunno whether this is changed to match
  the DEBUGGER_SPEED value)
- the web flasher has the speed hard-coded to 115200
- flashing time (time esptool.py flashing bootloader, partition table, and ~1.6MB application):
  921600 baud: 19s; 460800 baud: 28s; 230400 baud: 49s; 115200 baud: 93s;
  looks like 460800 is the sweet spot

## License

All files found in this repository use the Apache 2.0 License,
unless specified otherwise in a file's header.

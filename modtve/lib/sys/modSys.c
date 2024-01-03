#include "xs.h"

void xs_reset(xsMachine *the) {
#ifdef ESP32
	esp_restart();
#endif
}

#define XS_DEBUGGER_EXIT 0 // see xsAll.h
void xs_restart(xsMachine *the) {
	fxAbort(the, XS_DEBUGGER_EXIT);
}
// void fxDebugImport(xsMachine* the) {
// 	xsLog("OOPS: fxDebugImport\n");
// }

declare module "sys" {
  export function reset(): void // reset the microcontroller
  export function restart(): void // restart the XS VM without resetting the microcontroller
}

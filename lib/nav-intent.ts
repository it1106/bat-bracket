let _intentional = false
export function setIntentionalNav(): void { _intentional = true }
export function consumeIntentionalNav(): boolean {
  const v = _intentional; _intentional = false; return v
}

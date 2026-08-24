// jsdom has no ResizeObserver. Radix's Checkbox (used by search-source-form.tsx's
// autoSelectClassifications field) reads element size on mount via @radix-ui/react-use-size to keep
// its hidden native-input "bubble" in sync — that hook throws `ResizeObserver is not defined` under
// jsdom without this stub, before a single assertion runs. A no-op is enough: no test in this
// project asserts on layout/size, only on rendered content and interaction.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

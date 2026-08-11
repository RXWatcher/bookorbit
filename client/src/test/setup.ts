class TestStorage implements Storage {
  private readonly items = new Map<string, string>()

  get length(): number {
    return this.items.size
  }

  clear(): void {
    this.items.clear()
  }

  getItem(key: string): string | null {
    return this.items.get(String(key)) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.items.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.items.delete(String(key))
  }

  setItem(key: string, value: string): void {
    this.items.set(String(key), String(value))
  }
}

const testLocalStorage = new TestStorage()

Object.defineProperty(globalThis, 'Storage', {
  configurable: true,
  value: TestStorage,
  writable: true,
})

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: testLocalStorage,
  writable: true,
})

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'Storage', {
    configurable: true,
    value: TestStorage,
    writable: true,
  })

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: testLocalStorage,
    writable: true,
  })
}

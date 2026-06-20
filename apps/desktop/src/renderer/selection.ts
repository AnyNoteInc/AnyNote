declare global {
  interface Window {
    anynoteSetup?: { connect: (url: string) => Promise<{ ok: boolean; error?: string }> }
  }
}

const input = document.getElementById('url') as HTMLInputElement
const button = document.getElementById('connect') as HTMLButtonElement
const errorEl = document.getElementById('error') as HTMLDivElement

button.addEventListener('click', async () => {
  errorEl.textContent = ''
  button.disabled = true
  button.textContent = 'Проверка…'
  try {
    const result = (await window.anynoteSetup?.connect(input.value)) ?? {
      ok: false,
      error: 'Мост недоступен',
    }
    if (!result.ok) {
      errorEl.textContent = result.error ?? 'Сервер недоступен'
    }
  } finally {
    button.disabled = false
    button.textContent = 'Подключиться'
  }
})

export {}

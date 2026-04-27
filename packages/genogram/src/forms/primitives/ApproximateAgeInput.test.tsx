// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApproximateAgeInput } from './ApproximateAgeInput'

describe('ApproximateAgeInput', () => {
  it('starts in single-value mode and emits {kind:"value"}', async () => {
    const onChange = vi.fn()
    render(<ApproximateAgeInput value={undefined} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Возраст'), '42')
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'value', value: 42 })
  })

  it('switches to range and emits {kind:"range"}', async () => {
    const onChange = vi.fn()
    render(<ApproximateAgeInput value={undefined} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Диапазон' }))
    await userEvent.type(screen.getByLabelText('От'), '30')
    await userEvent.type(screen.getByLabelText('До'), '35')
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'range', from: 30, to: 35 })
  })
})

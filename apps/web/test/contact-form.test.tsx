// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ContactForm } from '@/components/public/contact-form'

describe('ContactForm', () => {
  it('renders all five fields', () => {
    render(<ContactForm />)
    expect(screen.getByLabelText('Имя')).toBeInTheDocument()
    expect(screen.getByLabelText('Компания')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Телефон')).toBeInTheDocument()
    expect(screen.getByLabelText('Что нужно')).toBeInTheDocument()
  })
})

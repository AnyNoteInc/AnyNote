export type SprintStatusChipColor = 'default' | 'primary' | 'success'

export function sprintStatusLabel(status: string): string {
  switch (status) {
    case 'PLANNED':
      return 'Планирование'
    case 'ACTIVE':
      return 'Активный'
    case 'COMPLETED':
      return 'Завершён'
    default:
      return status
  }
}

export function sprintStatusColor(status: string): SprintStatusChipColor {
  switch (status) {
    case 'ACTIVE':
      return 'primary'
    case 'COMPLETED':
      return 'success'
    default:
      return 'default'
  }
}

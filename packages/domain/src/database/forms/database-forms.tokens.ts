export const DATABASE_FORMS = {
  Repository: Symbol.for('domain/DatabaseFormRepository'),
  Service: Symbol.for('domain/DatabaseFormService'),
  AccessResolver: Symbol.for('domain/FormAccessResolver'),
  SubmissionService: Symbol.for('domain/FormSubmissionService'),
} as const

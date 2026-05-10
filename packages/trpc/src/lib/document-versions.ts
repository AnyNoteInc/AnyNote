import { ConsentDocumentType } from '@repo/db'

export type VersionResolver = (type: ConsentDocumentType) => string

let resolver: VersionResolver = () => 'sha256:unset'

export const setDocumentVersionResolver = (next: VersionResolver): void => {
  resolver = next
}

export const getDocumentVersionForType = (type: ConsentDocumentType): string => resolver(type)

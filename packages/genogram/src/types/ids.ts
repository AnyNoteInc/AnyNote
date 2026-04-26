declare const brand: unique symbol

export type Branded<T, K extends string> = T & { readonly [brand]: K }

export type PersonId = Branded<string, 'PersonId'>
export type UnionId = Branded<string, 'UnionId'>
export type ChildGroupId = Branded<string, 'ChildGroupId'>
export type BirthGroupId = Branded<string, 'BirthGroupId'>
export type PregnancyLossId = Branded<string, 'PregnancyLossId'>
export type AnnotationId = Branded<string, 'AnnotationId'>

export type EntityId =
  | PersonId
  | UnionId
  | ChildGroupId
  | BirthGroupId
  | PregnancyLossId
  | AnnotationId

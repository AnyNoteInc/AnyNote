import { describe, expect, it } from 'vitest'
import { computeLayout } from '../layout/computeLayout'
import {
  scenarioComplexGenogram,
  scenarioCouple,
  scenarioNuclearFamily,
  scenarioSolo,
  scenarioTwins,
  scenarioWithLoss,
} from '../layout/__fixtures__/scenarios'
import { newGenogram } from '../layout/__fixtures__/scenarios'
import { validateSchema } from '../model/validators'
import { checkInvariants } from '../model/invariants'
import { domainToFlow } from './domainToFlow'

describe('domainToFlow', () => {
  it('empty genogram produces no nodes and no edges', () => {
    const result = domainToFlow(newGenogram(), computeLayout(newGenogram()))
    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
  })

  it("solo person → single 'person' node, no edges", () => {
    const { data, ownerId } = scenarioSolo()
    const layout = computeLayout(data)
    const { nodes, edges } = domainToFlow(data, layout)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.id).toBe(ownerId)
    expect(nodes[0]!.type).toBe('person')
    expect(edges).toHaveLength(0)
  })

  it('couple → 2 person nodes + 1 union anchor + 1 marriage edge', () => {
    const { data, maleId, femaleId, unionId } = scenarioCouple()
    const layout = computeLayout(data)
    const { nodes, edges } = domainToFlow(data, layout)

    const nodeIds = nodes.map((n) => n.id).sort()
    expect(nodeIds).toEqual([maleId, femaleId, unionId].sort())

    const types = nodes.map((n) => n.type)
    expect(types.filter((t) => t === 'person')).toHaveLength(2)
    expect(types.filter((t) => t === 'union')).toHaveLength(1)

    expect(edges).toHaveLength(1)
    expect(edges[0]!.type).toBe('unionMarriage')
    expect(edges[0]!.source).toBe(maleId)
    expect(edges[0]!.target).toBe(femaleId)
  })

  it('cohabitation uses unionCohabitation edge type', () => {
    const { data, unionId } = scenarioCouple()
    data.entities.unions[unionId]!.kind = 'cohabitation'
    const layout = computeLayout(data)
    const { edges } = domainToFlow(data, layout)
    expect(edges[0]!.type).toBe('unionCohabitation')
  })

  it('divorce adds divorceSlash decoration and custodySide', () => {
    const { data, unionId } = scenarioCouple()
    data.entities.unions[unionId]!.divorce = {
      date: '2020-01-01',
      custodySide: 'female',
    }
    const layout = computeLayout(data)
    const { edges } = domainToFlow(data, layout)
    expect(edges[0]!.data?.decorations).toContain('divorceSlash')
    expect(edges[0]!.data?.custodySide).toBe('female')
  })

  it('nuclear family → person nodes + union + hub + trunk edge + 2 child edges', () => {
    const { data, unionId, childGroupId, child1Id, child2Id } = scenarioNuclearFamily()
    const layout = computeLayout(data)
    const { nodes, edges } = domainToFlow(data, layout)

    const typeCounts = nodes.reduce<Record<string, number>>((acc, n) => {
      const t = n.type ?? '(untyped)'
      acc[t] = (acc[t] ?? 0) + 1
      return acc
    }, {})
    expect(typeCounts.person).toBe(4)
    expect(typeCounts.union).toBe(1)
    expect(typeCounts.childrenHub).toBe(1)

    const edgeTypes = edges.map((e) => e.type).sort()
    expect(edgeTypes).toEqual(['child', 'child', 'unionMarriage', 'unionTrunk'])

    const trunk = edges.find((e) => e.type === 'unionTrunk')!
    expect(trunk.source).toBe(unionId)
    expect(trunk.target).toBe(childGroupId)

    const childEdges = edges.filter((e) => e.type === 'child')
    expect(childEdges.map((e) => e.source)).toEqual([childGroupId, childGroupId])
    expect(childEdges.map((e) => e.target).sort()).toEqual([child1Id, child2Id].sort())
  })

  it('twins → birthGroup node + 2 diagonals + 1 horizontal', () => {
    const { data, birthGroupId, twin1Id, twin2Id } = scenarioTwins()
    const layout = computeLayout(data)
    const { nodes, edges } = domainToFlow(data, layout)

    expect(nodes.find((n) => n.id === birthGroupId)?.type).toBe('birthGroup')

    const diagonals = edges.filter((e) => e.type === 'twinDiagonal')
    expect(diagonals).toHaveLength(2)
    expect(diagonals.map((e) => e.target).sort()).toEqual([twin1Id, twin2Id].sort())

    const horizontals = edges.filter((e) => e.type === 'twinHorizontal')
    expect(horizontals).toHaveLength(1)
    expect(horizontals[0]!.source).toBe(twin1Id)
    expect(horizontals[0]!.target).toBe(twin2Id)
  })

  it('fraternal birth group produces fraternalDiagonal edges, no horizontals', () => {
    const { data, birthGroupId } = scenarioTwins()
    data.entities.birthGroups[birthGroupId]!.kind = 'fraternal'
    const layout = computeLayout(data)
    const { edges } = domainToFlow(data, layout)

    expect(edges.filter((e) => e.type === 'fraternalDiagonal')).toHaveLength(2)
    expect(edges.filter((e) => e.type === 'twinHorizontal')).toHaveLength(0)
  })

  it('pregnancy loss → pregnancyLoss node + child edge from hub', () => {
    const { data, lossId, childGroupId } = scenarioWithLoss()
    const layout = computeLayout(data)
    const { nodes, edges } = domainToFlow(data, layout)

    const lossNode = nodes.find((n) => n.id === lossId)
    expect(lossNode?.type).toBe('pregnancyLoss')

    const edgeToLoss = edges.find((e) => e.type === 'child' && e.target === lossId)
    expect(edgeToLoss?.source).toBe(childGroupId)
  })

  it('person node position = layout center - half width', () => {
    const { data, ownerId } = scenarioSolo()
    const layout = computeLayout(data)
    const { nodes } = domainToFlow(data, layout)
    const personNode = nodes.find((n) => n.id === ownerId)!
    const layoutPos = layout.positions[ownerId]!
    // PERSON_BIG = 80, so position top-left = center - 40
    expect(personNode.position).toEqual({
      x: layoutPos.x - 40,
      y: layoutPos.y - 40,
    })
  })

  describe('complex genogram (reference image)', () => {
    const { data, ownerId } = scenarioComplexGenogram()
    const layout = computeLayout(data)
    const { nodes, edges } = domainToFlow(data, layout)

    it('domain passes zod schema', () => {
      expect(validateSchema(data)).toEqual([])
    })

    it('invariants pass (pairings, partnerOrder, birth group, single owner)', () => {
      expect(checkInvariants(data)).toEqual([])
    })

    it('owner is rendered and tagged isOwner', () => {
      const n = nodes.find((x) => x.id === ownerId)
      expect(n).toBeDefined()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((n!.data as any).isOwner).toBe(true)
    })

    it('renders all 22 people (4 gtgrand + 4 grand + 6 sisters + 2 parents + dead uncle + mom + 5 kids)', () => {
      const personNodes = nodes.filter((n) => n.type === 'person')
      // 2 gpA + 2 gpD + 2 paternalGran + 2 maternalGran + 6 sisters + dad + deadUncle + mom + 5 kids = 22
      expect(personNodes.length).toBe(22)
    })

    it('renders 5 unions (2 gtgrand + 2 grand + parents)', () => {
      const unions = nodes.filter((n) => n.type === 'union')
      expect(unions.length).toBe(5)
    })

    it("parents' marriage is divorced", () => {
      const divorced = edges
        .filter((e) => e.type === 'unionMarriage' || e.type === 'unionCohabitation')
        .filter((e) => e.data?.decorations?.includes('divorceSlash'))
      expect(divorced).toHaveLength(1)
    })

    it('twin birth group produces 2 diagonals + 1 horizontal', () => {
      expect(edges.filter((e) => e.type === 'twinDiagonal')).toHaveLength(2)
      expect(edges.filter((e) => e.type === 'twinHorizontal')).toHaveLength(1)
    })

    it('pregnancy losses: 2×abortion + 1×miscarriage', () => {
      const losses = nodes.filter((n) => n.type === 'pregnancyLoss')
      expect(losses).toHaveLength(3)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const kinds = losses.map((n) => (n.data as any).kind).sort()
      expect(kinds).toEqual(['abortion', 'abortion', 'miscarriage'])
    })

    it('death markers: dead sister + dead uncle + dead twin = 3 deceased with early-death cross', () => {
      const deceased = nodes
        .filter((n) => n.type === 'person')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((n) => (n.data as any).lifeStatus === 'deceased')
      expect(deceased).toHaveLength(3)
    })

    it('paternalGranFather is rendered as unknown', () => {
      const unknowns = nodes
        .filter((n) => n.type === 'person')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((n) => (n.data as any).isUnknown)
      expect(unknowns).toHaveLength(1)
    })

    it('generations span −3..0', () => {
      const gens = Object.values(layout.generations)
      expect(Math.min(...gens)).toBe(-3)
      expect(Math.max(...gens)).toBe(0)
    })
  })

  it('person label position honours resolveLabelPosition rule', () => {
    const { data, maleId, child1Id } = scenarioNuclearFamily()
    // male is direct/partner/owner → big → left
    // but in this scenario male is "direct" + role "owner" → big → left
    const layout = computeLayout(data)
    const { nodes } = domainToFlow(data, layout)
    const maleNode = nodes.find((n) => n.id === maleId)!
    const child1Node = nodes.find((n) => n.id === child1Id)!
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getLabelPos = (n: any) => n.data.label.position
    expect(getLabelPos(maleNode)).toBe('left')
    expect(getLabelPos(child1Node)).toBe('left') // direct blood child ⇒ big ⇒ left
  })
})

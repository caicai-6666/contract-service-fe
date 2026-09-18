export function normalizeContractNetwork(payload) {
  const nodes = [...new Map(payload.nodes.map(node => [node.document_id, node])).values()]
  const ids = new Set(nodes.map(node => node.document_id))
  const edges = [...new Map(payload.edges.map(edge => [edge.relation_id, edge])).values()]
    .filter(edge => edge.source_document_id !== edge.target_document_id
      && ids.has(edge.source_document_id) && ids.has(edge.target_document_id)
      && [edge.source_document_id, edge.target_document_id].includes(payload.center_document_id))
  const neighbors = new Set([payload.center_document_id, ...edges.flatMap(edge => [edge.source_document_id, edge.target_document_id])])
  return { ...payload, nodes: nodes.filter(node => neighbors.has(node.document_id)), edges }
}

export function layoutContractNetwork(network) {
  const others = network.nodes.filter(node => node.document_id !== network.center_document_id)
  return {
    nodes: network.nodes.map(node => {
      const isCenter = node.document_id === network.center_document_id
      const index = others.indexOf(node)
      const angle = index / Math.max(1, others.length) * Math.PI * 2 + .25
      const x = isCenter ? 0 : Math.cos(angle) * 150
      const y = isCenter ? 0 : Math.sin(angle) * 110
      const z = isCenter ? 0 : (index % 2 ? -1 : 1) * (65 + index * 7)
      return { ...node, id: node.document_id, isCenter, x, y, z, fx: x, fy: y, fz: z }
    }),
    links: network.edges.map(edge => ({ ...edge, source: edge.source_document_id, target: edge.target_document_id })),
  }
}

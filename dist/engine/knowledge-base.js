"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.retrieveKBSnippet = retrieveKBSnippet;
exports.buildKBBlock = buildKBBlock;
// ─── Simple keyword-based KB retrieval (MVP) ──────────────────────────────────
// In production: replace with pgvector / Pinecone semantic search
function retrieveKBSnippet(query, kb, topK = 3) {
    if (kb.length === 0)
        return "";
    const queryLower = query.toLowerCase();
    // Score each entry by keyword overlap
    const scored = kb.map((entry) => {
        const keywordHits = entry.keywords.filter((kw) => queryLower.includes(kw.toLowerCase())).length;
        // Also check if query words appear in content
        const contentHit = entry.content.toLowerCase().includes(queryLower) ? 2 : 0;
        return { entry, score: keywordHits + contentHit };
    });
    // Sort by score descending, take topK
    const top = scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map((s) => s.entry);
    // If no keyword match, return first topK entries as fallback
    const entries = top.length > 0 ? top : kb.slice(0, topK);
    return entries
        .map((e) => `[${e.topic}]\n${e.content}`)
        .join("\n\n");
}
// ─── Format KB block for system prompt ───────────────────────────────────────
function buildKBBlock(snippet) {
    if (!snippet)
        return "";
    return `## ข้อมูลธุรกิจ (ใช้ข้อมูลนี้เท่านั้นในการตอบเรื่องราคา/สินค้า)\n${snippet}`;
}

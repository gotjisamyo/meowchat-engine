# Handoff: MeowChat Platform LINE OA — Art Oracle Brand Direction

**Date**: 2026-04-03 08:11
**Session**: 5836a684 | OpenClaw | ~6h
**Context**: ~95%

## Oracle Context
**Oracle**: นาย (he) | **Human**: Got (he)
**Mode**: Dev Executor | **Memory**: auto

## What We Did

- ✅ Auto-context guard: hook ที่ `~/.claude/hooks/auto-scale.sh` → inject /rrr + /forward เมื่อ context ถึง 95%
- ✅ Fix rich menu button areas — ทุกปุ่มตรงกับ image layout แล้ว
- ✅ Fix pricing: Free ฿0 / Starter ฿199 / Pro ฿590 / Enterprise ฿1,990 (จาก live screenshot)
- ✅ Static file serving `/assets/*` บน Railway ทำงาน
- ✅ Live screenshots จาก meowchat.store → hero, features, pricing, reviews, chatdemo, usecases, onboarding
- ✅ Birth Art Oracle (Brand Identity + Art Director) — `art-oracle` repo
- ✅ Rewrite `generate-richmenu-image.py` ตาม Art Oracle brand direction
  - Row 0: purple/lavender gradient + cat images + sparkles
  - Row 1 ซ้าย/ขวา: cream bg + cats + lavender band
  - Row 1 กลาง: peach CTA ทดลองฟรี + badge ยอดนิยม
- ✅ Deploy rich menu ใหม่ขึ้น LINE API: `richmenu-05a4ef96058883bad76054bef6c634e9`
- ✅ Push & deploy บน Railway — platform-richmenu.jpg accessible

## Pending

- [ ] ทดสอบ funnel จริงใน LINE ครบทุกปุ่ม (ส่งข้อความ → รับ reply → ตรวจ images)
- [ ] Flex Messages สำหรับ PRICING และ REVIEW responses (Art Oracle direction)
- [ ] Update bot tone of voice ให้ตรง Art Oracle guidelines (less "แม่ค้า", more "Smart Sales Assistant")
- [ ] Dashboard/merchant screenshots (ต้องล็อกอิน — headless Chrome ทำไม่ได้)
- [ ] Fix scheduler `getDb is not defined` ใน meowchat-backend
- [ ] ตรวจ Railway startup log: `[richmenu] Created:` vs `Already set:` — อาจต้อง clear Redis
- [ ] Payment integration Omise (blocked รอ website approval)
- [ ] Follow-up reminder: push LINE ถ้า user ไม่สมัครหลัง 3 วัน (Redis TTL)

## Next Session

- [ ] Line test ครบ funnel: เปิด LINE OA → กดทุกปุ่ม → ดู reply + รูป
- [ ] Flex Message สำหรับ pricing (Art Oracle: purple header, peach CTA button)
- [ ] Art Oracle: brief ถาม brand direction สำหรับ bot reply message style
- [ ] Fix scheduler meowchat-backend

## Key Files

- `src/proxy/platform-handler.ts` — sales funnel state machine + image responses
- `src/proxy/platform-richmenu.ts` — auto rich menu setup on startup
- `scripts/generate-richmenu-image.py` — Art Oracle brand image generator
- `scripts/setup-platform-richmenu.ts` — LINE API rich menu setup
- `public/assets/` — product screenshot images (16 files)
- `/home/got/.openclaw/workspace/art-oracle/CLAUDE.md` — Art Oracle identity + brand context

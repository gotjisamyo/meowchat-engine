"use strict";
// ─── QR Code Scanner for payment slips ───────────────────────────────────────
// Uses jimp (pure JS image decode) + jsqr (QR decode) — no API cost
// Parses EMVCo TLV format used by Thai PromptPay / bank transfer slips
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanSlipQR = scanSlipQR;
const jimp_1 = __importDefault(require("jimp"));
const jsqr_1 = __importDefault(require("jsqr"));
// ─── Scan QR code from base64 image ──────────────────────────────────────────
async function scanSlipQR(imageBase64) {
    try {
        const buffer = Buffer.from(imageBase64, "base64");
        const image = await jimp_1.default.read(buffer);
        const { data, width, height } = image.bitmap;
        const code = (0, jsqr_1.default)(new Uint8ClampedArray(data), width, height);
        if (!code?.data)
            return null;
        console.log("[qr-scanner] QR found:", code.data.slice(0, 40) + "...");
        return parseEMVCo(code.data);
    }
    catch (err) {
        console.warn("[qr-scanner] scan failed:", err.message);
        return null;
    }
}
// ─── Parse EMVCo TLV format (Thai PromptPay standard) ────────────────────────
// Format: TAG(2) + LENGTH(2) + VALUE(n) repeating
function parseEMVCo(qrData) {
    const result = { amount: null, refNumber: null, bankCode: null };
    try {
        let i = 0;
        while (i + 4 <= qrData.length) {
            const tag = qrData.slice(i, i + 2);
            const len = parseInt(qrData.slice(i + 2, i + 4), 10);
            if (isNaN(len) || i + 4 + len > qrData.length)
                break;
            const value = qrData.slice(i + 4, i + 4 + len);
            i += 4 + len;
            // Tag 54 — Transaction Amount
            if (tag === "54") {
                const parsed = parseFloat(value);
                if (!isNaN(parsed))
                    result.amount = parsed;
            }
            // Tag 62 — Additional Data (contains reference label)
            if (tag === "62") {
                let j = 0;
                while (j + 4 <= value.length) {
                    const subTag = value.slice(j, j + 2);
                    const subLen = parseInt(value.slice(j + 2, j + 4), 10);
                    if (isNaN(subLen))
                        break;
                    const subValue = value.slice(j + 4, j + 4 + subLen);
                    j += 4 + subLen;
                    // SubTag 05 — Reference Label (เลขอ้างอิง)
                    if (subTag === "05")
                        result.refNumber = subValue;
                }
            }
            // Tag 26–51 — Merchant Account Info (bank identifier)
            const tagNum = parseInt(tag, 10);
            if (tagNum >= 26 && tagNum <= 51) {
                let j = 0;
                while (j + 4 <= value.length) {
                    const subTag = value.slice(j, j + 2);
                    const subLen = parseInt(value.slice(j + 2, j + 4), 10);
                    if (isNaN(subLen))
                        break;
                    const subValue = value.slice(j + 4, j + 4 + subLen);
                    j += 4 + subLen;
                    if (subTag === "00") {
                        if (subValue.toLowerCase().includes("promptpay"))
                            result.bankCode = "PromptPay";
                        else if (subValue.includes("004"))
                            result.bankCode = "KBank";
                        else if (subValue.includes("014"))
                            result.bankCode = "SCB";
                        else if (subValue.includes("002"))
                            result.bankCode = "BBL";
                        else if (subValue.includes("006"))
                            result.bankCode = "Krungthai";
                    }
                }
            }
        }
    }
    catch {
        // Return partial result
    }
    return result;
}

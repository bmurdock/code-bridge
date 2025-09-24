"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeLanguageModelError = normalizeLanguageModelError;
exports.createChatMessages = createChatMessages;
exports.createRequestOptions = createRequestOptions;
exports.parseChatRequest = parseChatRequest;
exports.initializeErrorMap = initializeErrorMap;
const vscode = __importStar(require("vscode"));
const zod_1 = require("zod");
const chatMessageSchema = zod_1.z.object({
    role: zod_1.z.enum(['user', 'assistant']).default('user'),
    content: zod_1.z.string().min(1, 'content is required')
});
const chatModelSelectorSchema = zod_1.z
    .object({
    id: zod_1.z.string().min(1).optional(),
    vendor: zod_1.z.string().min(1).optional(),
    family: zod_1.z.string().min(1).optional(),
    version: zod_1.z.string().min(1).optional()
})
    .optional();
const chatOptionsSchema = zod_1.z
    .object({
    temperature: zod_1.z.number().finite().optional(),
    maxOutputTokens: zod_1.z.number().int().positive().optional()
})
    .optional();
const chatRequestSchema = zod_1.z
    .object({
    prompt: zod_1.z.string().min(1).optional(),
    messages: zod_1.z.array(chatMessageSchema).nonempty().optional(),
    model: chatModelSelectorSchema,
    options: chatOptionsSchema
})
    .refine((value) => Boolean(value.prompt) || Boolean(value.messages), {
    message: 'prompt or messages is required'
});
const FALLBACK_LANGUAGE_MODEL_ERROR = {
    statusCode: 502,
    message: 'Language model request failed'
};
const LANGUAGE_MODEL_ERROR_MAP = initializeErrorMap();
function normalizeLanguageModelError(error, output) {
    if (error instanceof vscode.LanguageModelError) {
        output.warn(`Language model error (${error.code}): ${error.message}`);
        const normalized = LANGUAGE_MODEL_ERROR_MAP.get(error.code) ??
            LANGUAGE_MODEL_ERROR_MAP.get(error.code.toLowerCase()) ??
            FALLBACK_LANGUAGE_MODEL_ERROR;
        return normalized;
    }
    output.error(`Unhandled chat error: ${String(error)}`);
    return { statusCode: 500, message: 'Internal Server Error' };
}
function createChatMessages(payload) {
    const messages = [];
    if (payload.messages && payload.messages.length > 0) {
        for (const entry of payload.messages) {
            if (!entry || typeof entry.content !== 'string') {
                continue;
            }
            if (entry.role === 'assistant') {
                messages.push(vscode.LanguageModelChatMessage.Assistant(entry.content));
            }
            else {
                messages.push(vscode.LanguageModelChatMessage.User(entry.content));
            }
        }
    }
    else if (typeof payload.prompt === 'string') {
        messages.push(vscode.LanguageModelChatMessage.User(payload.prompt));
    }
    return messages;
}
function createRequestOptions(payload) {
    if (!payload.options) {
        return undefined;
    }
    const modelOptions = {};
    if (typeof payload.options.maxOutputTokens === 'number') {
        modelOptions.maxOutputTokens = payload.options.maxOutputTokens;
    }
    if (typeof payload.options.temperature === 'number') {
        modelOptions.temperature = payload.options.temperature;
    }
    if (Object.keys(modelOptions).length === 0) {
        return undefined;
    }
    return { modelOptions };
}
function parseChatRequest(raw) {
    return chatRequestSchema.parse(raw);
}
function initializeErrorMap() {
    const entries = [
        ['provider_not_found', { statusCode: 404, message: 'Requested model not available' }],
        ['model_not_found', { statusCode: 404, message: 'Requested model not available' }],
        ['not_allowed', { statusCode: 403, message: 'Model access not permitted' }],
        ['consent_required', { statusCode: 403, message: 'Model access not permitted' }],
        ['quota_exceeded', { statusCode: 429, message: 'Quota exceeded' }]
    ];
    try {
        const notFoundCode = vscode.LanguageModelError.NotFound().code;
        entries.push([notFoundCode, { statusCode: 404, message: 'Requested model not available' }]);
    }
    catch {
        // Ignore if the static constructor is unavailable.
    }
    try {
        const noPermissionsCode = vscode.LanguageModelError.NoPermissions().code;
        entries.push([noPermissionsCode, { statusCode: 403, message: 'Model access not permitted' }]);
    }
    catch {
        // Ignore if the static constructor is unavailable.
    }
    try {
        const blockedCode = vscode.LanguageModelError.Blocked().code;
        entries.push([blockedCode, { statusCode: 429, message: 'Quota exceeded' }]);
    }
    catch {
        // Ignore if the static constructor is unavailable.
    }
    return new Map(entries);
}
//# sourceMappingURL=chat-utils.js.map
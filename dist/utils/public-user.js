"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUBLIC_USER_SELECT = void 0;
// Operational screens only need identity and institutional rank.
exports.PUBLIC_USER_SELECT = {
    id: true,
    username: true,
    role: true,
    profile: {
        select: {
            fullName: true,
            rank: true,
            badge: true,
            avatarUrl: true,
        },
    },
};

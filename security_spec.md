# MIRAI Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Strict User Ownership & PII Isolation**: Every `/users/{userId}` profile contains private PII (`email`) and may only be read or written by the verified authenticated user whose `request.auth.uid == userId`.
2. **Master Gate Subcollection Sync**: A project at `/users/{userId}/projects/{projectId}` or task at `/users/{userId}/tasks/{taskId}` cannot be created unless the parent `/users/{userId}` document exists and belongs to `request.auth.uid`.
3. **Immutable Ownership & Timestamps**: `uid`, `ownerId`, `id`, and `createdAt` are immutable after creation. All `createdAt` and `updatedAt` timestamps must equal `request.time`.
4. **No Shadow Fields & Strict Boundaries**: Every create enforces `hasAll` + `hasOnly`, every update enforces `affectedKeys().hasOnly(...)` paired with the full `isValid*` schema validator, every ID matches `^[a-zA-Z0-9_\-]+$` (max 128 chars), and every string/array enforces explicit max sizes.
5. **Verified Identity Enforcement**: Standard writes require `request.auth != null && request.auth.token.email_verified == true`.
6. **Zero-Trust List Queries**: `allow list` on subcollections explicitly validates `resource.data.ownerId == request.auth.uid` without `get()` lookups.

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Return PERMISSION_DENIED)
1. **Cross-User Profile Read**: User B attempts `get` on `/users/{userA}` (PII leak attempt).
2. **Identity Spoofing on Create**: User A attempts to create `/users/{userA}/tasks/task_1` with `ownerId: "userB"`.
3. **Shadow Field Injection on Profile**: User A attempts to create `/users/{userA}` with extra ghost field `isAdmin: true`.
4. **Shadow Field Injection on Update**: User A updates `/users/{userA}/tasks/task_1` adding `role: "superuser"`.
5. **Unverified Email Write**: Authenticated user with `email_verified: false` attempts to write to `/users/{uid}/projects/proj_1`.
6. **ID Poisoning**: User A attempts to create `/users/{userA}/tasks/{150-char-junk-id}`.
7. **Orphaned Subcollection Write**: User A attempts to create `/users/{userA}/projects/proj_1` before `/users/{userA}` profile exists.
8. **Immutable Field Mutation**: User A attempts to update `createdAt` or `ownerId` on `/users/{userA}/tasks/task_1`.
9. **Client Timestamp Forgery**: User A creates `/users/{userA}/projects/proj_1` with backdated `createdAt: Timestamp(2020-01-01)`.
10. **Array Exhaustion Attack**: User A writes `detectedLanguages` with 50 items (exceeding max 12) or non-string elements.
11. **Value Poisoning on Allowed Update Key**: User A updates `title` on `/users/{userA}/tasks/task_1` with a 10,000-char string or boolean.
12. **Blanket Collection Scraping**: User A attempts `list` on `/users` or `/users/{userB}/tasks`.

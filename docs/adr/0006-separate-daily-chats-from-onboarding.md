# Separate daily chats from onboarding

Status: accepted

Conversation opens an empty daily chat. Onboarding remains a tagged, separate history so a person can start unrelated work without continuing the setup exchange.

Daily chats have independent persisted messages and use a task-assistance model with the accepted profile as context. They never invoke onboarding capture. The original conversation and call stay mounted during dashboard navigation, preserving live voice and existing profile correction behavior. Voice is currently available in that original conversation; daily chats support text.

Daily threads and priorities belong to the existing account conversation. This reuses authenticated ownership and tab-control checks without changing the live call's identity. It also means an explicit reset deletes the workspace with onboarding. The tradeoff is that moving profile or wearable data to a separate account-level model later will require migrating these ownership links.

This amends ADR 0005's same-chat default for the dashboard. Its graduated role still applies when someone explicitly returns to the original conversation.

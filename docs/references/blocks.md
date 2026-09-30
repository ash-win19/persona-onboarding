# Blocks.so component references

[Blocks.so](https://blocks.so/) is the component reference library for Persona's UI. Use applicable patterns when creating or updating a screen, adapting them to real product capabilities and the existing Persona brand tokens.

This dashboard adapts these MIT-licensed references:

- [Chat Application, chat-03](https://blocks.so/chat/chat-03): compact navigation, persistent conversation area, bottom profile disclosure and account actions.
- [Dashboard, dashboard-01](https://blocks.so/dashboard): collapsible sidebar, compact header, summary panels and recent activity rows.
- [Sidebar collection](https://blocks.so/sidebar): grouped navigation, inset content and responsive spacing.

The account disclosure uses the browser's native popover for keyboard activation, Escape, outside-click dismissal and focus restoration. Dashboard panels use actual conversation and connection state. Mobile keeps touch-sized bottom navigation with the same bottom account disclosure. Sidebar changes preserve the mounted conversation and voice session.

Other collections, including forms, dialogs, onboarding, grid lists and empty states, are available as references when those features need changes. Do not add unsupported actions or demo data just to fill a block. Persona's font stack, neutral palette, mark and pill calls to action remain the brand source.

Source repository: https://github.com/ephraimduncan/blocks. The upstream MIT notice is retained in [blocks-LICENSE.md](blocks-LICENSE.md).

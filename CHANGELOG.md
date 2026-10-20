# Unreleased

- [Added] The first harvest of a resource, or a try without its tool, writes it into the Field Guide; the chat card and a notification say so.
- [Breaking][Removed] The "Whisper the Tools Needed" setting and the whispered tool card: the Field Guide shows the tools instead.
- [Added] An eye on each resource and group in the Resource Book sets whether it is always, once found, or never in the Field Guide; the guide's footer sets which fields players see.
- [Added] Field Guide: players open it from the Items directory, or by right-clicking a spot, to see the resources they know, the tools each takes and what it gives.
- [Added] Packages can suggest whether each resource they register shows in the Field Guide (`guide` in registerResources).

# 0.0.3

- [Added] First release on the Foundry VTT package list, approved by Foundry. Nothing else changed since 0.0.2.

# 0.0.2

- [Fixed] A Harvest Spot's button and the sparks of a strike only show where your tokens can see them: a wall, darkness without darkvision, the Blinded status or a floor between Levels hides them. A GM with a token selected sees what that token sees.
- [Changed] Harvest sounds come from the spot and are heard only by tokens within reach, 12 grid spaces by default and set as **Reach** in Harvest Sounds. A wall that blocks sound, or a floor between Levels (a Define Surface region), stops them. A GM with no token selected still hears every harvest.
- [Added] A resource's sound can be switched off, or given a reach of its own, from the speaker button in the Resource Book.

# 0.0.1

- [Added] Harvest Spots: Regions on the map where a token mines, chops, gathers or carves, with a button over the spot and a set number of strikes.
- [Added] Resource Book to create, edit, tag and drag resources onto the map or onto a token.
- [Added] Tool Sets for Mine, Chop, Gather and Carve, plus up to four tools of a resource's own.
- [Added] What a strike gives lands beside the token as Canvas Loot items, with a chat card.
- [Added] Strike, chop, gather and carve animations and sounds, the Wilds and Forge themes, and the Harvest Sounds window.
- [Added] API and hooks for modules and systems to register resources and add rules to a strike.

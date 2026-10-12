# Unreleased

- [Fixed] A Harvest Spot's button and the sparks of a strike only show where your tokens can see them: a wall, darkness without darkvision, the Blinded status or a floor between Levels hides them. A GM with a token selected sees what that token sees.
- [Changed] Harvest sounds come from the spot and are heard only by tokens within reach, 12 grid spaces by default and set as **Reach** in Harvest Sounds. A wall that blocks sound, or a floor between Levels (a Define Surface region), stops them. A GM with no token selected still hears every harvest.

# 0.0.1

- [Added] Harvest Spots: Regions on the map where a token mines, chops, gathers or carves, with a button over the spot and a set number of strikes.
- [Added] Resource Book to create, edit, tag and drag resources onto the map or onto a token.
- [Added] Tool Sets for Mine, Chop, Gather and Carve, plus up to four tools of a resource's own.
- [Added] What a strike gives lands beside the token as Canvas Loot items, with a chat card.
- [Added] Strike, chop, gather and carve animations and sounds, the Wilds and Forge themes, and the Harvest Sounds window.
- [Added] API and hooks for modules and systems to register resources and add rules to a strike.

# Règles de curation des parcours (Epic 33)

**À lire avant de transcrire la première étape d'une édition** (CLAUDE.md,
règle 16). Chaque règle vient d'une erreur réelle trouvée après coup, en
relecture adverse ou par le contrôle des distances — le but est que la
première transcription soit juste, pas que la relecture la rattrape.
Toute erreur nouvelle trouvée en relecture ajoute ou précise une règle ici,
dans la même PR que son correctif.

## Lire le profil

1. **Jamais de mémoire, jamais sur l'image entière.** Transcrire seulement
   depuis des agrandissements (moitiés ×3, tiers ×4,5 pour les images
   courtes, zoom ×2,5 sur une zone dense). La première transcription faite
   sur l'image non agrandie inventait des km (Epic 33, story 33.1).
2. **Deux rangées de chiffres : graduations et km des points.** La rangée
   des graduations rondes (10, 20, 30…) n'est pas celle des points. Lire
   une graduation pour un point décale le km d'un cran — une trentaine de
   km faux sur 7 étapes en 1987, Col du Kreuzweg au km 60, une graduation
   (1987/6 ; même erreur en 1988). Pour chaque point : le chiffre doit être **sous la
   colonne du nom**, pas seulement voisin.
3. **Compter noms et chiffres d'un groupe serré.** Quatre noms pour trois
   chiffres : un nom n'a pas de km. Mesurer la position de chaque colonne
   contre deux graduations (px/km) pour savoir lequel (1986/23 : La
   Forêt-le-Roi sans chiffre, toute la série avait glissé d'un cran).
4. **Un nom sans km imprimé n'est pas placé**, même si sa position sur
   l'axe semble lisible — il garde une note qui le dit (Le Champ du Feu
   1987/6). Exception tolérée : un col majeur indispensable à la mesure,
   ajouté avec « km lu sur la graduation » dans sa note (Col de
   Marie-Blanque 1986/12).
5. **Km strictement croissants** ; un nom présent deux fois dans une étape
   (Ettlingen 1987/3) se corrige sur la bonne occurrence, pas la première
   trouvée.

## Placer les points

6. **Le bourg, pas le centre de la commune.** Le centroïde IGN ou le point
   d'une relation administrative peut tomber loin du village : Allemond
   (4 km), Asasp-Arros (le passage est au hameau d'Arros), Troo (2 km),
   Saint-Pierre-d'Entremont (3,6 km), Bastogne sur son arrondissement
   (9,2 km), Luxembourg au centre du pays (23 km). Huez : le point de la
   relation tombe dans la station de l'Alpe d'Huez — vérifier par
   **géocodage inverse** ; à défaut de nœud `place=village`, ancrer à
   l'église ou à la mairie, avec une note.
7. **Homonymes : cohérence avec les voisins du profil.** Un point plus loin
   à vol d'oiseau de son voisin que le km du profil ne le permet est faux
   (Champigny-le-Sec au lieu de Souzay-Champigny, Marlhes pour Marlhoux,
   un ruisseau homonyme pour Canfranc).
8. **Jamais de commune de rattachement (`geocodeAs`) devinée** : une source
   ou rien (Villagrains 1988, Noyant-la-Plaine).
9. **Pas d'aller-retour dans une étape.** Un Tour ne va jamais rejoindre
   un point A pour revenir sur ses pas et tourner plus loin. Un point qui
   oblige le tracé à faire demi-tour est mal placé (homonyme, centre de
   commune, mauvais ordre) — le corriger, ou le retirer avec une note.
   Seules exceptions : les circuits finaux en boucle (Champs-Élysées,
   Bordeaux), déclarés par `circuit_km`.
   `check-itineraries --legs` les signale (« aller-retour à … », dès 1 km
   de route reprise en sens inverse) ; « incertain » quand un point non
   placé est sauté — le placer ou l'expliquer.
10. **Retirer un point, c'est supprimer `lat`, `lon` et `how`**, pas
    seulement passer `confidence` à `non-place` : sinon il reste tracé et
    routé (Le Champ du Feu, La Forêt-le-Roi — test d'invariant dans
    `test/placeSearch.test.js`).

## Contrôler avant la PR

11. `node scripts/check-itineraries.js --write --legs <année>` (ou
    `<année>/<étape>`). **Chaque tronçon suspect est trié avant la PR** :
    corrigé, ou justifié par une note. Une ligne droite plus longue que le
    profil (+1 km) est toujours une erreur, de km ou de position.
12. **Le contrôle ne voit pas tout** : un km décalé de 1 km n'est jamais
    signalé, de 2 km une fois sur cinq. La relecture contre l'image reste
    obligatoire ; « dans la tolérance » ne prouve pas la transcription.
13. **L'écart s'affiche, il ne se masque pas** (CLAUDE.md, règle 12) :
    une étape hors tolérance après correction reste hors tolérance, avec
    sa cause dans la note d'étape. BRouter renvoie parfois 403 : les
    tronçons routés en voiture sont remesurés plus tard, jamais cachés.

## Vérifier un point placé

14. **L'altitude du profil est un témoin.** Chaque nom du profil porte son
    altitude : la comparer au relief (MNT) du point placé. Un écart de
    plus de 100 m trahit le mauvais lieu — Saint-Pierre-d'Entremont à
    983 m pour 650 imprimés, Aime à 895 pour 680, La Giettaz à 1 304 pour
    1 080, et « Chaumeil (village) » à 630 pour 530 : ce dernier n’était
    vraisemblablement pas le village (relecture 1987).
15. **Commune nouvelle : le village, pas la commune fusionnée.** Le centre
    de Salignac-Eyvigues tombait vers Eyvigues, 3,8 km du village de
    Salignac nommé par le profil (1987/12, aller-retour de 5 km) ;
    Beynac-et-Cazenac, Aime-la-Plagne, Asasp-Arros : même piège.
16. **Trier sur un passage BRouter, pas sur le repli voiture.** Quand
    BRouter refuse (403), OSRM route en voiture : 1992 passait de 10
    étapes hors tolérance à 6, et ses allers-retours changeaient, entre
    un passage voiture et un passage vélo. Relancer avant de trier ; un
    aller-retour qui n'apparaît qu'en voiture se note comme tel.
17. **Un aller-retour ou un tronçon suspect sur un point de commune :
    essayer la mairie avant d'écrire « traversée » ou « laissé tel
    quel ».** Pas seulement pour les allers-retours : Tourrettes-sur-Loup
    (1993/12), « entre les centres, laissé tel quel », était à 2,4 km de
    sa mairie — placé là, le tronçon suspect disparaît. Labrit, Langerwehe, Felletin et Varize
    (1992) étaient notés « traversée de bourg » : placés à leur mairie
    (Nominatim `amenity=townhall`), l'aller-retour disparaît. La note
    n'est juste que si l'aller-retour reste avec le point sur la mairie
    (Zumaia).
18. **Relire tout le profil de chaque étape, nom par nom, contre la
    transcription — pas seulement autour des tronçons suspects.** En
    1994, 11 noms omis étaient dans des étapes sans aucun tronçon
    suspect (relecture adverse). Pour un tronçon suspect, relire
    d'abord le profil entre ses deux points. Le premier suspect est un nom imprimé mais omis à la
    transcription — Mornex, Montigaud, Frappe, Côte de Point B. (1992).
    Une arrivée imprimée avec son adresse (« Boulevard du Centenaire »,
    « avenue de la Zurriola ») est une source : la placer là, pas au
    centre-ville.
19. **Une entrée de ville imprimée annonce un circuit final.** « Bordeaux
    - entrée » au km 184,5 (1993/18) : l'arrivée est 16 km plus loin sur
    un circuit — `circuit_km` au km de l'entrée, sinon le circuit fausse
    la mesure et compense un vrai écart ailleurs.
20. **Avant d'accuser la transcription — ou d'écrire « cause non
    établie » —, comparer au routage voiture.** Pontorson → Précey
    (1993/4), noté « cause non établie », faisait 12,8 km en voiture pour
    12 au profil.
    BRouter (vélo) évite certaines routes (tunnels, routes de gorges) :
    Roussillon → Le Chaudan, 44 km en vélo, 13,5 en voiture pour 14 au
    profil (1993/12). Si OSRM colle au profil, c'est le routeur — le
    noter, ne pas déplacer les points.


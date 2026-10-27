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
   **Avant de refuser un point pour un aller-retour, regarder où il
   se produit** : `--legs` nomme le point de demi-tour, pas forcément
   celui qu'on vient d'ajouter. La Côte des Égats (1991/17) a été
   refusée pour un aller-retour qui se faisait à Quet-en-Beaumont, au
   centre de sa commune — Quet à sa mairie, les deux se placent. Même
   chose pour un refus « tronçon suspect » : le refaire tester après
   tout autre changement de l'étape (Chevigny, 1991/3, refusé pour un
   tronçon vers un point retiré ensuite).
   `check-itineraries --legs` les signale (« aller-retour à … », dès 1 km
   de route reprise en sens inverse) ; « incertain » quand un point non
   placé est sauté — le placer ou l'expliquer.
10. **Retirer un point, c'est supprimer `lat`, `lon` et `how`**, pas
    seulement passer `confidence` à `non-place` : sinon il reste tracé et
    routé (Le Champ du Feu, La Forêt-le-Roi — test d'invariant dans
    `test/placeSearch.test.js`).
    L'inverse aussi : **placer à la main un point que le géocodeur avait
    laissé, c'est retirer son `confidence: non-place`** (20 points de
    1998, trouvés par ce même test).

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
    **Mesurer l'altitude au point stocké**, pas au centre que renvoie
    une nouvelle recherche Nominatim : en 1988, sept côtes notées « au
    pied » l'étaient pour le centroïde administratif, alors que le point
    stocké était à l'altitude du sommet (Saint-Romain, 420 m pour 415).
15. **Commune nouvelle : le village, pas la commune fusionnée.** Le centre
    de Salignac-Eyvigues tombait vers Eyvigues, 3,8 km du village de
    Salignac nommé par le profil (1987/12, aller-retour de 5 km) ;
    Beynac-et-Cazenac, Aime-la-Plagne, Asasp-Arros : même piège.
16. **Trier sur un passage BRouter, pas sur le repli voiture.** Un BRouter
    auto-hébergé (`ETAPEFORGE_BROUTER=http://127.0.0.1:17777/brouter`,
    tuiles `segments4` de brouter.de, profil `fastbike` de la même
    version) n'a renvoyé aucun 403 ni aucun repli voiture sur deux contrôles
    complets de 1997 (21/10/2026), de quelques minutes chacun. Quand
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
    Un nom de sprint imprimé à côté d'une ville n'est pas un lieu :
    « Hewlett-Packard » (Eybens, 1987/20), « Schwaben Bräu » (1987/3) sont
    des sponsors. Un « 1er passage » imprimé avant l'arrivée annonce un
    circuit final, comme une entrée de ville (règle 19 ; Berlin et
    Stuttgart, 1987/1 et 1987/3).
19. **Une entrée de ville imprimée annonce un circuit final.** « Bordeaux
    - entrée » au km 184,5 (1993/18) : l'arrivée est 16 km plus loin sur
    un circuit — `circuit_km` au km de l'entrée, sinon le circuit fausse
    la mesure et compense un vrai écart ailleurs. Repère appliqué à partir de 1991 (1994/14 Montpellier, non
    déclaré pour la raison notée, et 1996/5 Besançon, triés avant, sont à
    revoir) :
    6 km ou plus entre l’entrée et l’arrivée (Pau 1995/16 : 6 km). En
    deçà, l'entrée reste un point de passage (non déclarée en 1991 :
    Argentan, Alençon, Castres, Aix-les-Bains, Mâcon).
20. **Avant d'accuser la transcription — ou d'écrire « cause non
    établie » —, comparer au routage voiture.** Pontorson → Précey
    (1993/4), noté « cause non établie », faisait 12,8 km en voiture pour
    12 au profil.
    BRouter (vélo) évite certaines routes (tunnels, routes de gorges) :
    Roussillon → Le Chaudan, 44 km en vélo, 13,5 en voiture pour 14 au
    profil (1993/12). Si OSRM colle au profil, c'est le routeur — le
    noter, ne pas déplacer les points.

21. **Un lieu-dit que Nominatim connaît se place, il ne se rattache pas.**
    Rattaché à sa commune (`geocodeAs`), un lieu-dit n'est pas routé :
    le Pont de Normandie (1995/4, +15,5 %) et le Col de Soudet (1995/16,
    −23,2 %) faussaient toute l'étape. Le rattachement est réservé au
    lieu introuvable, au lieu en bout de route (Cap Fréhel), qui
    créerait un aller-retour, et au lieu que Nominatim ne connaît que
    par un centre administratif (Bonneval-Tarentaise). **Appliquer la
    règle à tous les rattachements de l'édition**, pas seulement à ceux
    qui sautent aux yeux : en 1995, 11 de plus en relecture. **Côtes et
    cols compris** : une côte rattachée au centre de sa commune alors
    que son hameau ou son sommet est connu n'est pas routée (1996 :
    Saint-Anastaise, Mont de l'Enclus, Fiolaz, Senoy) ; un col écarté
    pour homonymie se retrouve en cherchant avec le département (Col du
    Rousset, Drôme). **Deux contrôles avant de placer** (33.15) : le nom
    renvoyé est bien celui cherché (« Thier de Theux » n'est pas
    « Mont-Theux ») ; pour une côte, l'altitude MNT du point est celle
    du sommet imprimé — un hameau au bord de l'eau (Hallembaye,
    Pourville) est le pied de la côte, pas son sommet.
    **Chercher borné autour des voisins** (`viewbox` des deux points
    voisins, `bounded=1`) avant de conclure « introuvable » : un nom
    courant (Don, L'Étoile, Le Calvaire, Blanzy) se noie sous ses
    homonymes dans une recherche globale — onze lieux de 1991 n’étaient
    trouvés qu'ainsi. Essayer aussi la variante d'orthographe (Pallud /
    Palud, Pongivart / Pontgivart, Cazaux / Cazeaux, Monpach / Mompach,
    Pétrou / Peyrou). Un lieu-dit que Nominatim ne connaît que par son
    arrêt de bus ou un poteau homonyme sur la route (Lavey 1991, La
    Fresquière et Basse-Plaine 1989) se place sur cet arrêt, altitude
    contrôlée. Et un tronçon suspect ne fait pas refuser un lieu qui
    existe : il se note (règle 11 ; Bray, Berdorf 1989).

22. **Vérifier le départ et l'arrivée de chaque étape avant le reste.**
    Une ville-étape devenue commune déléguée n'est plus dans l'index IGN
    des communes, et `stage_towns.json` peut n'en avoir aucune position
    (Vire, Vire Normandie, 1997) : le géocodeur prend alors le premier
    candidat Nominatim, ici un homonyme à 17 km. Il sert ensuite de repère
    au point suivant, et toute l'étape décroche (1997/3 : 5 villes non
    placées). Placer la ville à sa mairie (règle 17), puis relancer.
23. **Un point qu'aucun voisin ne laisse placer est d'abord une lecture
    à refaire.** « Lure » (1997/18), à 21 km à vol d'oiseau de son voisin
    pour 8,5 au profil, était « Luze » sur l'agrandissement. Relire le nom
    au zoom ×9 avant de conclure à un profil contradictoire.
24. **Un « ok » obtenu avec un aller-retour n'est pas un ok.** Le
    kilométrage d'un aller-retour compte deux fois et comble un détour
    réel que le tracé n'a pas : 1997/14 passait à −0,6 % avec 5,3 km
    repris à La Perrière ; le point corrigé (village, pas centre de
    commune), l'étape tombe à −7,3 %, et l'écart vient d'un détour de
    vallée que le profil ne nomme pas. 1997/18 : −2,4 % avec l'aller-retour
    au col du Ballon d'Alsace, −5,3 % sans. Corriger tous les
    allers-retours **avant** de lire l'écart, et noter la cause du nouvel
    écart, jamais garder le point fautif parce qu'il « tombe juste ».
    L'altitude imprimée aide à placer un sommet : 1 060 m au Ballon
    d'Alsace désignaient la jonction sous le col (1 082 m), pas le col
    (1 171 m) ; 2 004 m à Courchevel, l'altiport, pas le centre.
25. **Le départ (km 0) n'est jamais contrôlé : le vérifier à la main.**
    `check-itineraries --legs` ne mesure pas le premier tronçon (départ
    fictif, zone neutralisée) et le géocodeur laisse 10 km de marge au
    point suivant : une ville de départ posée au centre IGN de sa commune
    passe donc inaperçue. En 2000, Bagnères-de-Bigorre était à 7,9 km au
    sud de sa mairie, Limoges à 4,1 km, Avignon à 3,7 (audit de l'édition).
    Comparer chaque départ à sa mairie (géocodage inverse), et la ligne
    droite départ → premier point au km du profil ; au-delà de 2 km de
    la mairie, placer le départ à la mairie avec une note.

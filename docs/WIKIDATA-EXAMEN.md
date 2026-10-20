# Examen des pistes Wikidata — villes (Epic 33.16)

Le rapport `docs/WIKIDATA-RECOUPEMENT.md` (Epic 34.1) relevait 41 lignes de
villes placées à plus de 10 km de la ville que Wikidata rattache à l'étape.
Chacune est classée ci-dessous. Une position n'est corrigée que si une source
l'établit (CLAUDE.md, règle 12). Les corrections vont dans
`pipeline/data/stage_towns_overrides.json`, chacune avec sa source dans
`note`, puis sont réappliquées par `writeStageTowns`.

Les sources sont les tableaux d'étapes de Wikipédia, relus le 20/10/2026 :
- en.wikipedia : « YYYY Tour de France » ;
- fr.wikipedia : « Tour de France YYYY ».

Les positions viennent de Nominatim (OpenStreetMap). Après correction, le
rapport régénéré tombe de 41 à 24 lignes.

Les distances (16) et les dates décalées (28) ne sont pas encore triées :
c'est la story 33.17.

## Homonyme chez nous : position corrigée (17 lignes)

| Étape | Avant | Après | Source |
|---|---|---|---|
| 1926/1 arrivée, 1926/2 départ | « Mülhausen » placé à Mulhausen (Bas-Rhin) | Mulhouse | en.wikipedia : « Evian to Mulhouse » |
| 1964/13 arrivée, 1964/14 départ, 1993/16 départ | « Andorra » placé à Formiguères (Pyrénées-Orientales) | Andorre-la-Vieille | fr.wikipedia : « [[Andorre-la-Vieille\|Andorre]] » ; Wikidata Q1863 |
| 1970/8 arrivée | Felsberg (Hesse), à 287 km | émetteur Europe 1 du Felsberg, Überherrn (Sarre) | fr.wikipedia : « Émetteur Europe 1 du [[Felsberg (Sarre)\|Felsberg]] » |
| 1973/7 (2ᵉ secteur) arrivée, 2020/18 départ | « Méribel » placé près de Sallanches | Méribel-les-Allues | en.wikipedia : « Gaillard to Méribel », « Méribel to La Roche-sur-Foron » |
| 2020/17 arrivée | idem | col de la Loze | en.wikipedia : « Grenoble to Méribel (Col de la Loze) » |
| 2001/19 arrivée, 2014/21 départ | Évry (Yonne) | Évry (Essonne) | en.wikipedia : « [[Évry, Essonne\|Évry]] » |
| 2011/1 arrivée | point près de Marans (Charente-Maritime) | sommet du mont des Alouettes, Les Herbiers | en.wikipedia : « Passage du Gois to Mont des Alouettes » |
| 2015/2 arrivée | centre de la province de Zélande | île de Neeltje Jans | en.wikipedia : la ligne d'arrivée était sur Neeltje Jans |
| 2024/1 arrivée, 2024/3 départ | centre de la province (Rimini, Piacenza) | la commune | Wikidata ; Nominatim (limite de la commune) |
| 1997/16 arrivée, 1997/17 départ | centre du canton de Fribourg | la ville de Fribourg | Wikidata ; Nominatim (limite de la commune) |

Les deux demi-étapes de 1973 portent toutes deux le numéro 7. La correction de
Méribel est donc faite par libellé et vaut pour toutes les éditions. L'arrivée
de 2020/17 au col de la Loze garde sa propre entrée, prioritaire.

Recontrôle : seule l'étape 1993/16 a un itinéraire dans
`stage_itineraries.json`. `check-itineraries.js --legs 1993/16` redonne un
résultat identique au contrôle enregistré : −1,8 %, 0 tronçon suspect.

## Erreur côté Wikidata : laissé (6 lignes)

| Étape | Wikidata | Pourquoi c'est Wikidata qui se trompe |
|---|---|---|
| 1948/1 arrivée, 1948/2 départ | Trouville (Seine-Maritime), Q900702 | en.wikipedia écrit « [[Trouville-sur-Mer\|Trouville]] » (Calvados) |
| 1973/8 départ, 1994/18 départ | Moutiers (Meurthe-et-Moselle), Q208732 | en.wikipedia écrit « [[Moûtiers]] » (Savoie), au lendemain de l'arrivée à Méribel |
| 1982/11 départ et arrivée | Valence (Drôme), Q8848 | contre-la-montre de Valence d'Agen (Tarn-et-Garonne), départ et arrivée au même endroit |

## Lieu de départ ou d'arrivée réel distinct de la ville-étape : à sourcer (11 lignes)

Wikidata y donne vraisemblablement le lieu réel du départ (souvent en
banlieue) ou de l'arrivée, distinct de la ville qui nomme l'étape. Aucune
position n'est changée sans une source sur le lieu exact.

| Étape | Ville-étape | Lieu selon Wikidata |
|---|---|---|
| 1903/1 départ | Paris | Villeneuve-Saint-Georges (Montgeron, selon la tradition, à sourcer) |
| 1903/6 arrivée | Paris | Ville-d'Avray |
| 1905/1 départ | Paris | Noisy-le-Grand |
| 1938/1 départ | Paris | Le Vésinet |
| 1947/1 départ | Paris | Pierrefitte-sur-Seine |
| 2003/1 départ | Saint-Denis | Montgeron |
| 1947/17 départ | Bordeaux | Saint-André-de-Cubzac |
| 1969/19 départ | Bordeaux | Libourne |
| 1962/21 arrivée, 1962/22 départ | Nevers | Pougues-les-Eaux |
| 1982/1 départ | Basel | Schupfart |

## Autres cas laissés, cause notée (7 lignes)

| Étape | Écart | Cause |
|---|---|---|
| 1984/6 départ | « Louvroil », à 193 km de Cergy-Pontoise | Le lien de en.wikipedia est faux : « [[Louvroil\|Cergy-Pontoise]] ». Le constructeur a retenu la cible du lien. Le vrai départ est Cergy-Pontoise (arrivée de la veille, Wikidata). La correction demande de changer le libellé, ce que `stage_towns_overrides.json` ne sait pas faire : story 33.18. |
| 1964/7 départ | Besançon, à 55 km de Champagnole | en.wikipedia donne « Besançon to Thonon-les-Bains ». Wikidata donne vraisemblablement un départ réel, à sourcer. |
| 1973/6 départ | Mulhouse, à 38 km de Belfort | en.wikipedia donne « Mulhouse to Divonne-les-Bains ». Même cas, à sourcer. |
| 1959/18 départ | Grenoble, à 55 km du col du Lautaret | Départ réel ou erreur de Wikidata : à sourcer. |
| 1939/16a arrivée | Briançon, à 61 km de Bonneval-sur-Arc | Les demi-étapes de 1939 sont découpées autrement des deux côtés (appariement à vérifier), à sourcer. |
| 1997/11 départ | Andorra Arcalis, à 14 km d'Andorre-la-Vieille | en.wikipedia donne « Andorra Arcalis to Perpignan ». Nous suivons la ville-étape publiée. |
| 1994/3 arrivée | Eurotunnel, à 29 km du « tunnel sous la Manche » | Déjà vérifié en curation (terminal de Coquelles, confiance « verifie »). Wikidata ne donne que le tunnel. |

Total : 17 + 6 + 11 + 7 = 41 lignes.

# Distances et dates (Epic 33.17)

Notre distance et notre date officielles viennent du tableau d'étapes de
en.wikipedia. Elles sont relues par `pipeline/wikipedia.js` à l'import d'une
édition et par `scripts/build-stage-towns.js`. J'ai vérifié chaque ligne
signalée sur les deux pages Wikipédia, relues le 20/10/2026 :
- en.wikipedia : notre source, et sa valeur est bien la nôtre ;
- fr.wikipedia : la troisième source.

Classement :
- **notre donnée fausse** : fr.wikipedia et Wikidata concordent contre en.wikipedia ;
- **Wikidata faux** : fr.wikipedia confirme notre valeur ;
- **non tranché** : les trois sources divergent, ou une autre source sérieuse
  contredit les deux autres. Toutes sont citées.

Aucune correction n'est appliquée ici. Il n'existe pas encore de mécanisme
pour corriger une distance ou une date officielle à l'import d'une édition
(`stage_towns_overrides.json` ne porte que des positions et des libellés).
C'est la story 33.19.

## Distances (16 lignes)

| Étape | en.wikipedia (nous) | fr.wikipedia | Wikidata | Classement |
|---|---|---|---|---|
| 1906/6 Nice – Marseille | 292 | 292 | 308 | Wikidata faux |
| 1906/13 Caen – Paris | 259 | 259 | 246 | Wikidata faux |
| 1927/15 Toulon – Nice | 220 | 280 | 280 | notre donnée fausse |
| 1952/15 Avignon – Perpignan | 255 | 255 | 275 | Wikidata faux |
| 1964/20 Brive – Puy de Dôme | 217 | 237,5 | 237,5 | notre donnée fausse |
| 1965/20 Lyon – Auxerre | 198,5 | 298,5 | 298,5 | notre donnée fausse |
| 1970/5b Rouen – Amiens | 223 | 113 | 113 | notre donnée fausse |
| 1970/16 Montpellier – Toulouse | 160 | 259,5 | 259,5 | notre donnée fausse |
| 1980/5 Liège – Lille | 249 | 249,3 | 236,5 | Wikidata faux |
| 1985/13 Villard-de-Lans (clm) | 32 | 31,8 | 38 | Wikidata faux |
| 1987/11 Poitiers – Chaumeil | 206 | 255 | 255 | notre donnée fausse (le profil ledicodutour transcrit va jusqu'au km 249, `stage_itineraries.json`) |
| 1988/prologue Pornichet – La Baule | 3,8 | « 3,8 + 1 » (préface non officielle) | 1 | non tranché : contre-la-montre par équipes de 3,8 km puis 1 km pour un seul coureur ; chaque source n'en garde qu'une partie |
| 1988/16 Tarbes – Pau | 35 | 38 | 38 | notre donnée fausse |
| 1988/17 Pau – Bordeaux | 198 | 210 | 210 | non tranché : le profil officiel transcrit (ledicodutour) va jusqu'au km 197,5, ce qui est cohérent avec 198 |
| 1998/12 Tarascon-sur-Ariège – Le Cap d'Agde | 190 | 222 | 206 | notre donnée gardée : en.wikipedia note que l'étape, prévue sur 206 km, a été raccourcie à 190 km (grève des coureurs) ; Wikidata donne la distance prévue ; le 222 de fr.wikipedia n'est pas expliqué |
| 2019/14 Tarbes – Tourmalet | 111 | 117,5 | 117,5 | notre donnée fausse |

Bilan des distances : 8 fausses chez nous (1927/15, 1964/20, 1965/20, 1970/5b,
1970/16, 1987/11, 1988/16, 2019/14), 5 fausses côté Wikidata, 2 non
tranchées, et 1998/12 gardée (distance réellement courue).

## Dates décalées (28 lignes)

| Étapes | en.wikipedia (nous) | fr.wikipedia | Wikidata | Classement |
|---|---|---|---|---|
| 1905/3, 7, 8, 9, 10, 11 | un jour plus tôt | = Wikidata | = fr | notre donnée fausse (6) |
| 1907/5 | 16/07 | 16/07 | 15/07 | Wikidata faux |
| 1912/12 | 21/07 | 22/07 | 22/07 | notre donnée fausse |
| 1920/9 à 1920/14 | un jour plus tard | = Wikidata | = fr | notre donnée fausse (6) |
| 1920/15 | 27/07 | 25/07 | 25/07 | notre donnée fausse |
| 1948/7, 17, 18 | = fr | 07/07, 21/07, 22/07 | un jour plus tôt | Wikidata faux (3) |
| 1950/20 | 05/08 | 05/08 | 04/08 | Wikidata faux |
| 1951/17 | 22/07 | 22/07 | 21/07 | Wikidata faux |
| 1954/17 | 26/07 | 26/07 | 25/07 | Wikidata faux |
| 1955/10 | 17/07 | 17/07 | 16/07 | Wikidata faux |
| 1957/15b | 13/07 | 12/07 | 12/07 | notre donnée fausse (fr.wikipedia donne aussi le 12/07 au secteur a) |
| 1977/13a, 13b | 15/07 | 15/07 | 14/07 | Wikidata faux (2) |
| 1983/21 | 23/07 | 23/07 | 22/07 | Wikidata faux |
| 1986/14, 18 | 17/07, 21/07 | 17/07, 21/07 | 18/07, 20/07 | Wikidata faux (2) |

Bilan des dates : 15 fausses chez nous (1905, 1912, 1920, 1957), 13 côté
Wikidata.

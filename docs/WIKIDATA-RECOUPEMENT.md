# Recoupement des villes-étapes avec Wikidata

Généré le 2026-10-20 par `node scripts/wikidata-crosscheck.js --md` (backlog 34.1).
Source : Wikidata (CC0), query.wikidata.org. 118 éditions comparées à `pipeline/data/stage_towns.json`.

**Ce sont des pistes, pas des corrections.** Un écart vient aussi bien d'un homonyme
géocodé chez nous que d'une erreur ou d'une date décalée sur Wikidata. Chaque
correction passe par la curation, source citée (CLAUDE.md règle 12).

- Villes à plus de 10 km de la ville Wikidata : 27 départs, 18 arrivées
- Distances à plus de 5 % de Wikidata : 25
- Étapes sans étape Wikidata le même jour : 26

## Villes

| Étape | Écart | Confiance actuelle |
|---|---|---|
| 1903/1 (départ) | « Paris » placé à 15 km de « Villeneuve-Saint-Georges » (Wikidata Q244241) | ok |
| 1903/6 (arrivée) | « Paris » placé à 12 km de « Ville-d'Avray » (Wikidata Q456327) | ok |
| 1905/1 (départ) | « Paris » placé à 15 km de « Noisy-le-Grand » (Wikidata Q207605) | ok |
| 1905/11 (départ) | « Caen » placé à 153 km de « Rennes » (Wikidata Q647) | ok |
| 1905/11 (arrivée) | « Paris » placé à 201 km de « Caen » (Wikidata Q41185) | ok |
| 1926/1 (arrivée) | « Mülhausen » placé à 127 km de « Mulhouse » (Wikidata Q79815) | ok |
| 1926/2 (départ) | « Mülhausen » placé à 127 km de « Mulhouse » (Wikidata Q79815) | ok |
| 1938/1 (départ) | « Paris » placé à 16 km de « Le Vésinet » (Wikidata Q641607) | ok |
| 1939/16 (arrivée) | « Briançon » placé à 61 km de « Bonneval-sur-Arc » (Wikidata Q736370) | ok |
| 1947/1 (départ) | « Paris » placé à 12 km de « Pierrefitte-sur-Seine » (Wikidata Q253939) | ok |
| 1947/17 (départ) | « Bordeaux » placé à 20 km de « Saint-André-de-Cubzac » (Wikidata Q667867) | ok |
| 1948/1 (arrivée) | « Trouville-sur-Mer » placé à 44 km de « Trouville, Seine-Maritime » (Wikidata Q900702) | ok |
| 1948/2 (départ) | « Trouville-sur-Mer » placé à 44 km de « Trouville, Seine-Maritime » (Wikidata Q900702) | ok |
| 1948/17 (départ) | « Mulhouse » placé à 97 km de « Strasbourg » (Wikidata Q6602) | ok |
| 1948/17 (arrivée) | « Strasbourg » placé à 130 km de « Metz » (Wikidata Q22690) | ok |
| 1959/18 (départ) | « Grenoble » placé à 55 km de « col du Lautaret » (Wikidata Q1107509) | ok |
| 1962/21 (arrivée) | « Nevers » placé à 11 km de « Pougues-les-Eaux » (Wikidata Q46575) | ok |
| 1962/22 (départ) | « Nevers » placé à 11 km de « Pougues-les-Eaux » (Wikidata Q46575) | ok |
| 1964/7 (départ) | « Besançon » placé à 55 km de « Champagnole » (Wikidata Q477013) | ok |
| 1964/13 (arrivée) | « Andorra » placé à 49 km de « Andorre-la-Vieille » (Wikidata Q1863) | douteux |
| 1964/14 (départ) | « Andorra » placé à 49 km de « Andorre-la-Vieille » (Wikidata Q1863) | douteux |
| 1969/19 (départ) | « Bordeaux » placé à 28 km de « Libourne » (Wikidata Q6544) | ok |
| 1970/8 (arrivée) | « Felsberg » placé à 287 km de « Émetteur d'Europe 1 » (Wikidata Q896321) | ok |
| 1973/6 (départ) | « Mulhouse » placé à 38 km de « Belfort » (Wikidata Q171545) | ok |
| 1973/7 (arrivée) | « Méribel » placé à 58 km de « Les Allues » (Wikidata Q537798) | douteux |
| 1973/8 (départ) | « Moûtiers » placé à 419 km de « Moutiers » (Wikidata Q208732) | ambigu |
| 1982/1 (départ) | « Basel » placé à 29 km de « Schupfart » (Wikidata Q66314) | ok |
| 1982/11 (départ) | « Valence d'Agen » placé à 330 km de « Valence » (Wikidata Q8848) | ok |
| 1982/11 (arrivée) | « Valence d'Agen » placé à 330 km de « Valence » (Wikidata Q8848) | ok |
| 1984/6 (départ) | « Louvroil » placé à 193 km de « Cergy-Pontoise » (Wikidata Q18681428) | ok |
| 1993/16 (départ) | « Andorra » placé à 49 km de « Andorre-la-Vieille » (Wikidata Q1863) | douteux |
| 1994/3 (arrivée) | « Eurotunnel » placé à 29 km de « tunnel sous la Manche » (Wikidata Q10257) | verifie |
| 1994/18 (départ) | « Moûtiers » placé à 419 km de « Moutiers » (Wikidata Q208732) | ambigu |
| 1997/11 (départ) | « Andorra Arcalis » placé à 14 km de « Andorre-la-Vieille » (Wikidata Q1863) | ok |
| 1997/16 (arrivée) | « Fribourg » placé à 14 km de « Fribourg » (Wikidata Q36378) | ok |
| 1997/17 (départ) | « Fribourg » placé à 14 km de « Fribourg » (Wikidata Q36378) | ok |
| 2001/19 (arrivée) | « Évry » placé à 73 km de « Évry » (Wikidata Q192393) | douteux |
| 2003/1 (départ) | « Saint-Denis » placé à 27 km de « Montgeron » (Wikidata Q242569) | ok |
| 2011/1 (arrivée) | « Mont des Alouettes » placé à 64 km de « mont des Alouettes » (Wikidata Q956593) | douteux |
| 2014/21 (départ) | « Évry » placé à 73 km de « Évry » (Wikidata Q192393) | douteux |
| 2015/2 (arrivée) | « Zeeland » placé à 23 km de « Neeltje Jans » (Wikidata Q2330240) | ok |
| 2020/17 (arrivée) | « Méribel » placé à 61 km de « col de la Loze » (Wikidata Q86666408) | douteux |
| 2020/18 (départ) | « Méribel » placé à 62 km de « Méribel » (Wikidata Q914361) | douteux |
| 2024/1 (arrivée) | « Rimini » placé à 14 km de « Rimini » (Wikidata Q13369) | ok |
| 2024/3 (départ) | « Piacenza » placé à 23 km de « Plaisance » (Wikidata Q13329) | ok |

## Distances

| Étape | Écart | Confiance actuelle |
|---|---|---|
| 1905/11 | 253 km ici, 167 km sur Wikidata (+51.5 %) | — |
| 1906/6 | 292 km ici, 308 km sur Wikidata (-5.2 %) | — |
| 1906/13 | 259 km ici, 246 km sur Wikidata (+5.3 %) | — |
| 1927/15 | 220 km ici, 280 km sur Wikidata (-21.4 %) | — |
| 1948/17 | 120 km ici, 195 km sur Wikidata (-38.5 %) | — |
| 1952/15 | 255 km ici, 275 km sur Wikidata (-7.3 %) | — |
| 1964/20 | 217 km ici, 237.5 km sur Wikidata (-8.6 %) | — |
| 1965/20 | 198.5 km ici, 298.5 km sur Wikidata (-33.5 %) | — |
| 1970/5 | 223 km ici, 113 km sur Wikidata (+97.3 %) | — |
| 1970/16 | 160 km ici, 259.5 km sur Wikidata (-38.3 %) | — |
| 1976/5 | 4 km ici, 4.3 km sur Wikidata (-7.0 %) | — |
| 1980/prologue | 8 km ici, 7.6 km sur Wikidata (+5.3 %) | — |
| 1980/5 | 249 km ici, 236.5 km sur Wikidata (+5.3 %) | — |
| 1982/prologue | 7 km ici, 7.4 km sur Wikidata (-5.4 %) | — |
| 1983/prologue | 6 km ici, 5.5 km sur Wikidata (+9.1 %) | — |
| 1984/prologue | 5 km ici, 5.4 km sur Wikidata (-7.4 %) | — |
| 1985/prologue | 6 km ici, 6.8 km sur Wikidata (-11.8 %) | — |
| 1985/13 | 32 km ici, 38 km sur Wikidata (-15.8 %) | — |
| 1987/11 | 206 km ici, 255 km sur Wikidata (-19.2 %) | — |
| 1988/prologue | 3.8 km ici, 1 km sur Wikidata (+280.0 %) | — |
| 1988/16 | 35 km ici, 38 km sur Wikidata (-7.9 %) | — |
| 1988/17 | 198 km ici, 210 km sur Wikidata (-5.7 %) | — |
| 1998/12 | 190 km ici, 206 km sur Wikidata (-7.8 %) | — |
| 2002/prologue | 7 km ici, 6.5 km sur Wikidata (+7.7 %) | — |
| 2019/14 | 111 km ici, 117.5 km sur Wikidata (-5.5 %) | — |

## Étapes sans correspondance

| Étape | Écart | Confiance actuelle |
|---|---|---|
| 1905/3 | aucune étape Wikidata le 1905-07-14 | — |
| 1905/7 | aucune étape Wikidata le 1905-07-22 | — |
| 1905/8 | aucune étape Wikidata le 1905-07-24 | — |
| 1905/9 | aucune étape Wikidata le 1905-07-26 | — |
| 1905/10 | aucune étape Wikidata le 1905-07-28 | — |
| 1907/5 | aucune étape Wikidata le 1907-07-16 | — |
| 1912/12 | aucune étape Wikidata le 1912-07-21 | — |
| 1920/9 | aucune étape Wikidata le 1920-07-14 | — |
| 1920/10 | aucune étape Wikidata le 1920-07-16 | — |
| 1920/11 | aucune étape Wikidata le 1920-07-18 | — |
| 1920/12 | aucune étape Wikidata le 1920-07-20 | — |
| 1920/13 | aucune étape Wikidata le 1920-07-22 | — |
| 1920/14 | aucune étape Wikidata le 1920-07-24 | — |
| 1920/15 | aucune étape Wikidata le 1920-07-27 | — |
| 1948/7 | aucune étape Wikidata le 1948-07-07 | — |
| 1948/18 | aucune étape Wikidata le 1948-07-22 | — |
| 1950/20 | aucune étape Wikidata le 1950-08-05 | — |
| 1951/17 | aucune étape Wikidata le 1951-07-22 | — |
| 1954/17 | aucune étape Wikidata le 1954-07-26 | — |
| 1955/10 | aucune étape Wikidata le 1955-07-17 | — |
| 1957/15 | aucune étape Wikidata le 1957-07-13 | — |
| 1977/13 | aucune étape Wikidata le 1977-07-15 | — |
| 1977/13 | aucune étape Wikidata le 1977-07-15 | — |
| 1983/21 | aucune étape Wikidata le 1983-07-23 | — |
| 1986/14 | aucune étape Wikidata le 1986-07-17 | — |
| 1986/18 | aucune étape Wikidata le 1986-07-21 | — |

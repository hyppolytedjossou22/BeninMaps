/* ==========================================================
   BeninMaps — app.js
   Ce fichier fait vivre la page : il crée la carte, cherche
   des lieux, localise l'utilisateur, calcule un trajet et
   le lit à voix haute.
   Bibliothèques / services utilisés :
   - Leaflet (L)  : affiche la carte et les marqueurs
   - Nominatim    : transforme un nom de lieu en coordonnées (et inversement)
   - OSRM         : calcule l'itinéraire routier
   - speechSynthesis : la voix du navigateur
   ========================================================== */

/* ---------- 1. CRÉATION DE LA CARTE ---------- */

// Centre approximatif du Bénin [latitude, longitude] (non utilisé plus bas).
const beninCenter = [9.3077, 2.3158];

// Crée la carte dans <div id="map">. On enlève le zoom par défaut (zoomControl: false)
// pour le replacer nous-mêmes en bas à droite. La vue de départ est Porto-Novo, zoom 7.
const map = L.map('map', { zoomControl: false }).setView([6.4969, 2.6289], 7);

// Ajoute le fond de carte (les "tuiles" d'OpenStreetMap). {z}/{x}/{y} sont
// remplacés automatiquement par Leaflet selon la zone et le zoom affichés.
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);

// Marqueur du "lieu affiché" (ville cherchée ou choisie). Il est déplacé, jamais recréé.
const placeMarker = L.marker([6.4969, 2.6289]).addTo(map);

// Marqueur de la position GPS de l'utilisateur et son cercle de précision.
// Ils restent vides tant que l'utilisateur ne s'est pas localisé.
let userMarker;
let accuracyCircle;

/* ---------- 2. RÉCUPÉRATION DES ÉLÉMENTS HTML ---------- */
// document.getElementById('x') retourne l'élément de index.html ayant id="x".
// On les stocke dans des constantes pour pouvoir les modifier ensuite.

// Recherche
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('place-search');
const searchStatus = document.getElementById('search-status');
// Bouton "Me localiser" et panneau "Votre emplacement"
const locateButton = document.getElementById('locate-button');
const locationName = document.getElementById('location-name');
const locationDetail = document.getElementById('location-detail');
const coordinates = document.getElementById('coordinates');
const accuracy = document.getElementById('accuracy');
// Textes affichés par-dessus la carte
const mapCoordinates = document.getElementById('map-coordinates');
const mapCaption = document.getElementById('map-caption-text');
// Panneau "Où souhaitez-vous aller ?"
const routeForm = document.getElementById('route-form');
const routeDestination = document.getElementById('route-destination');
const routeStatus = document.getElementById('route-status');
const routeGuidance = document.getElementById('route-guidance');
const routeSummary = document.getElementById('route-summary');
const startGuidanceButton = document.getElementById('start-guidance');
const stopGuidanceButton = document.getElementById('stop-guidance');

/* ---------- 3. VARIABLES D'ÉTAT DU TRAJET ---------- */
// "let" car ces valeurs changent au fil de l'utilisation.
let routeLayer;          // le tracé vert du trajet sur la carte
let destinationMarker;   // le marqueur de la destination
let routeSteps = [];     // la liste des étapes (tourner à gauche, etc.)
let activeStepIndex = 0; // l'étape en cours d'annonce
let guidanceWatchId;     // identifiant du suivi GPS continu (pour pouvoir l'arrêter)

/* ---------- 4. FONCTIONS UTILITAIRES D'AFFICHAGE ---------- */

// Met en forme une coordonnée : 6.4969 -> "6.49690° N".
// Si la valeur est négative on utilise la direction opposée (S ou O).
// Math.abs enlève le signe, toFixed(5) garde 5 décimales.
function formatCoordinate(value, positive, negative) {
  const direction = value < 0 ? negative : positive;
  return `${Math.abs(value).toFixed(5)}\u00b0 ${direction}`;
}

// Centre la carte sur un lieu, déplace le marqueur, ouvre une bulle avec le nom
// et met à jour les textes affichés sur la carte.
function showPosition(latitude, longitude, label) {
  map.setView([latitude, longitude], 15); // zoom 15 = niveau quartier
  placeMarker.setLatLng([latitude, longitude]).bindPopup(label).openPopup();
  mapCoordinates.textContent = `${formatCoordinate(latitude, 'N', 'S')}   ${formatCoordinate(longitude, 'E', 'O')}`;
  mapCaption.textContent = label;
}

// Affiche la position GPS de l'utilisateur : marqueur, cercle de précision,
// textes et coordonnées dans le panneau. Retourne aussi les valeurs utiles.
function showUserPosition(position) {
  // "Déstructuration" : on extrait trois valeurs de position.coords.
  // "accuracy: accuracyMeters" renomme la valeur, car "accuracy" est déjà
  // le nom de l'élément HTML plus haut.
  const { latitude, longitude, accuracy: accuracyMeters } = position.coords;

  // Vrai si les coordonnées sont dans un rectangle qui englobe le Bénin.
  const withinBenin = latitude >= 6.2 && latitude <= 12.5 && longitude >= 0.7 && longitude <= 3.9;

  // Icône personnalisée : un simple <span> stylé par .user-marker dans style.css.
  const markerIcon = L.divIcon({ className: '', html: '<span class="user-marker"></span>', iconSize: [22, 22], iconAnchor: [11, 11] });

  // On retire les anciens marqueurs avant d'en poser de nouveaux.
  if (userMarker) map.removeLayer(userMarker);
  if (accuracyCircle) map.removeLayer(accuracyCircle);
  userMarker = L.marker([latitude, longitude], { icon: markerIcon }).addTo(map);
  // Le cercle a pour rayon la précision du GPS (en mètres).
  accuracyCircle = L.circle([latitude, longitude], {
    radius: accuracyMeters,
    color: '#16834b',
    weight: 1,
    fillColor: '#16834b',
    fillOpacity: 0.1
  }).addTo(map);

  map.setView([latitude, longitude], 16);
  mapCoordinates.textContent = `${formatCoordinate(latitude, 'N', 'S')}   ${formatCoordinate(longitude, 'E', 'O')}`;
  mapCaption.textContent = withinBenin ? 'Votre position, Bénin' : 'Votre position, hors du Bénin';
  locationName.textContent = withinBenin ? 'Position repérée au Bénin' : 'Vous semblez être hors du Bénin';
  locationDetail.textContent = 'Position GPS utilisée comme départ du trajet.';
  document.getElementById('latitude').textContent = formatCoordinate(latitude, 'N', 'S');
  document.getElementById('longitude').textContent = formatCoordinate(longitude, 'E', 'O');
  coordinates.hidden = false; // affiche le bloc latitude/longitude
  accuracy.textContent = `Précision estimée : environ ${Math.round(accuracyMeters)} m`;
  accuracy.hidden = false;

  return { latitude, longitude, withinBenin };
}

/* ---------- 5. GUIDAGE VOCAL ---------- */

// Lit un texte à voix haute avec la voix française du navigateur.
function speakInstruction(text) {
  // Certains navigateurs n'ont pas de synthèse vocale.
  if (!('speechSynthesis' in window)) {
    routeStatus.textContent = 'La synthèse vocale n’est pas disponible dans ce navigateur.';
    return;
  }

  window.speechSynthesis.cancel(); // coupe ce qui était en train d'être dit
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'fr-FR';
  // Cherche une voix dont la langue commence par "fr" (fr-FR, fr-BE, ...).
  const frenchVoice = window.speechSynthesis.getVoices().find((voice) => voice.lang.toLowerCase().startsWith('fr'));
  if (frenchVoice) utterance.voice = frenchVoice;
  window.speechSynthesis.speak(utterance);
}

// OSRM renvoie des données techniques (type de manœuvre, direction, nom de rue).
// Cette fonction les transforme en phrase française, par ex. "Tournez à gauche sur Rue X."
function describeStep(step) {
  const maneuver = step.maneuver || {};
  const road = step.name ? ` sur ${step.name}` : ''; // nom de la rue s'il existe
  if (maneuver.type === 'arrive') return 'Vous êtes arrivé à destination.';
  if (maneuver.type === 'depart') return `Commencez le trajet${road}.`;
  // Rond-point : on annonce le numéro de sortie (1re, 2e, 3e...).
  if (maneuver.type === 'roundabout' || maneuver.type === 'rotary') {
    const exit = maneuver.exit ? ` Prenez la ${maneuver.exit}${maneuver.exit === 1 ? 're' : 'e'} sortie.` : ' Prenez la sortie indiquée.';
    return `Au rond-point,${exit}${road}`;
  }

  // Dictionnaire : mot anglais d'OSRM -> expression française.
  const directions = {
    left: 'à gauche',
    right: 'à droite',
    straight: 'tout droit',
    'slight left': 'légèrement à gauche',
    'slight right': 'légèrement à droite',
    'sharp left': 'franchement à gauche',
    'sharp right': 'franchement à droite',
    uturn: 'faites demi-tour'
  };
  const direction = directions[maneuver.modifier] || 'continuez';
  if (maneuver.type === 'turn' || maneuver.type === 'end of road' || maneuver.type === 'fork') {
    return `Tournez ${direction}${road}.`;
  }
  return `Continuez ${direction}${road}.`;
}

// Calcule la distance en mètres entre deux points [longitude, latitude]
// avec la formule de haversine (distance sur une sphère, la Terre).
// 6371000 = rayon de la Terre en mètres.
function distanceBetween(first, second) {
  const radians = (degrees) => degrees * Math.PI / 180; // degrés -> radians
  const latitudeDelta = radians(second[1] - first[1]);
  const longitudeDelta = radians(second[0] - first[0]);
  const latitude1 = radians(first[1]);
  const latitude2 = radians(second[1]);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

// Appelée à chaque nouvelle position GPS pendant le guidage.
// Si l'utilisateur est à moins de 180 m de la prochaine manœuvre, on l'annonce.
function updateGuidance(position) {
  const nextStep = routeSteps[activeStepIndex + 1]; // l'étape suivante
  if (!nextStep || !nextStep.maneuver.location) return; // rien à annoncer

  const distance = distanceBetween(
    [position.coords.longitude, position.coords.latitude],
    nextStep.maneuver.location
  );
  if (distance <= 180) {
    // Au-delà de 60 m on ajoute "Dans environ 150 mètres, " (arrondi à 50 m).
    const prefix = distance > 60 ? `Dans environ ${Math.round(distance / 50) * 50} mètres, ` : '';
    speakInstruction(`${prefix}${describeStep(nextStep)}`);
    activeStepIndex += 1; // on passe à l'étape suivante
    routeStatus.textContent = describeStep(nextStep);
    // Arrivé : on arrête le suivi mais on laisse finir la phrase en cours.
    if (nextStep.maneuver.type === 'arrive') stopGuidance(true);
  }
}

// Arrête le suivi GPS et remet les boutons dans leur état initial.
// keepSpeech = true : on ne coupe pas la voix (utile pour finir "Vous êtes arrivé").
function stopGuidance(keepSpeech = false) {
  if (guidanceWatchId !== undefined) navigator.geolocation.clearWatch(guidanceWatchId);
  guidanceWatchId = undefined;
  if (!keepSpeech && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  startGuidanceButton.hidden = false;
  stopGuidanceButton.hidden = true;
}

// Démarre le guidage. Il doit être lancé par un clic : les navigateurs
// n'autorisent la voix et le GPS continu qu'après une action de l'utilisateur.
function startGuidance() {
  if (!routeSteps.length) return; // pas de trajet calculé
  if (!('geolocation' in navigator)) {
    routeStatus.textContent = 'La géolocalisation est indisponible dans ce navigateur.';
    return;
  }
  if (!('speechSynthesis' in window)) {
    routeStatus.textContent = 'La synthèse vocale n’est pas disponible dans ce navigateur.';
    return;
  }

  activeStepIndex = 0;
  startGuidanceButton.hidden = true;
  stopGuidanceButton.hidden = false;
  routeStatus.textContent = 'Guidage vocal activé. En attente de votre position…';
  speakInstruction(describeStep(routeSteps[0])); // annonce la 1re étape tout de suite
  // watchPosition appelle updateGuidance à chaque changement de position.
  // Le 2e argument est la fonction appelée en cas d'erreur GPS.
  guidanceWatchId = navigator.geolocation.watchPosition(updateGuidance, () => {
    routeStatus.textContent = 'Position GPS indisponible. Vérifiez l’autorisation de localisation.';
    stopGuidance();
  }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 });
}

/* ---------- 6. TRACER UN TRAJET (formulaire "Où souhaitez-vous aller ?") ---------- */
// "async" permet d'utiliser "await" : attendre une réponse (GPS, internet)
// sans bloquer la page. Étapes : GPS -> recherche destination -> itinéraire -> dessin.
routeForm.addEventListener('submit', async (event) => {
  event.preventDefault(); // empêche le rechargement de la page à l'envoi du formulaire
  const destinationQuery = routeDestination.value.trim(); // trim() enlève les espaces autour
  if (!destinationQuery) return;

  // Désactive le bouton pendant le calcul pour éviter les doubles clics.
  routeForm.querySelector('button[type="submit"]').disabled = true;
  routeGuidance.hidden = true;
  routeStatus.textContent = 'Récupération de votre position GPS…';

  // try/catch : si une étape échoue, on saute directement au catch plus bas.
  try {
    if (!('geolocation' in navigator)) throw new Error('geolocation');
    // getCurrentPosition fonctionne par rappels (callbacks). On l'enveloppe dans
    // une Promise pour pouvoir écrire "await" devant.
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 });
    });
    // Le GPS est récupéré avant toute recherche : il devient l'origine réelle du trajet.
    const currentPosition = showUserPosition(position);
    const origin = [currentPosition.longitude, currentPosition.latitude]; // OSRM veut [lon, lat]

    // Étape 1 : trouver les coordonnées de la destination avec Nominatim.
    routeStatus.textContent = 'Recherche de la destination…';
    // URLSearchParams fabrique la partie "?format=...&q=..." de l'adresse web.
    // countrycodes: 'bj' limite la recherche au Bénin, limit: '1' garde le meilleur résultat.
    const searchParams = new URLSearchParams({ format: 'jsonv2', q: destinationQuery, countrycodes: 'bj', limit: '1', 'accept-language': 'fr' });
    const searchResponse = await fetch(`https://nominatim.openstreetmap.org/search?${searchParams}`);
    if (!searchResponse.ok) throw new Error('search');
    const destinations = await searchResponse.json(); // convertit la réponse en objet JavaScript
    if (!destinations.length) {
      routeStatus.textContent = 'Destination introuvable au Bénin. Essayez une autre recherche.';
      return; // le "finally" réactive quand même le bouton
    }

    // Étape 2 : demander l'itinéraire en voiture à OSRM.
    const destination = destinations[0];
    routeStatus.textContent = 'Calcul de l’itinéraire…';
    const destinationCoordinates = [Number(destination.lon), Number(destination.lat)];
    // overview=full : tracé complet / geometries=geojson : format lisible par Leaflet /
    // steps=true : inclut les étapes pour le guidage vocal.
    const routeResponse = await fetch(`https://router.project-osrm.org/route/v1/driving/${origin.join(',')};${destinationCoordinates.join(',')}?overview=full&geometries=geojson&steps=true`);
    if (!routeResponse.ok) throw new Error('route');
    const routeResult = await routeResponse.json();
    if (routeResult.code !== 'Ok' || !routeResult.routes.length) {
      routeStatus.textContent = 'Aucun itinéraire routier trouvé pour ces lieux.';
      return;
    }

    // Étape 3 : dessiner le trajet et garder les étapes pour le guidage vocal.
    const route = routeResult.routes[0]; // OSRM peut en proposer plusieurs, on prend le 1er
    // display_name est une longue adresse séparée par des virgules : on garde les 2 premiers morceaux.
    const label = destination.display_name.split(',').slice(0, 2).join(',');
    stopGuidance(); // coupe un éventuel ancien guidage
    // Supprime l'ancien trajet et l'ancien marqueur s'ils existent.
    if (routeLayer) map.removeLayer(routeLayer);
    if (destinationMarker) map.removeLayer(destinationMarker);
    routeLayer = L.geoJSON(route.geometry, { style: { color: '#16834b', weight: 6, opacity: 0.85 } }).addTo(map);
    // GeoJSON est en [lon, lat], Leaflet en [lat, lon] : reverse() inverse l'ordre.
    destinationMarker = L.marker(destinationCoordinates.slice().reverse()).addTo(map).bindPopup(label);
    map.fitBounds(routeLayer.getBounds(), { padding: [45, 45] }); // zoome pour voir tout le trajet
    // flatMap rassemble les étapes de tous les tronçons ("legs") dans une seule liste.
    routeSteps = route.legs.flatMap((leg) => leg.steps).filter((step) => step.maneuver);
    // distance en mètres -> km ; durée en secondes -> minutes.
    routeSummary.textContent = `${(route.distance / 1000).toFixed(1)} km · environ ${Math.round(route.duration / 60)} min · ${label}`;
    routeGuidance.hidden = false; // affiche le bouton "Démarrer le guidage vocal"
    routeStatus.textContent = 'Itinéraire prêt. Activez le guidage vocal pour commencer.';
  } catch (error) {
    // error.message contient le mot passé à "throw new Error(...)" plus haut.
    const messages = {
      geolocation: 'La géolocalisation est indisponible dans ce navigateur.',
      search: 'La recherche de destination a échoué. Vérifiez votre connexion.',
      route: 'Le calcul du trajet a échoué. Réessayez dans un instant.'
    };
    // Si le message n'est pas dans la liste, c'est une erreur du GPS (ex. permission refusée).
    routeStatus.textContent = messages[error.message] || 'Position GPS inaccessible. Autorisez la localisation et réessayez.';
  } finally {
    // "finally" s'exécute toujours, que tout ait réussi ou échoué.
    routeForm.querySelector('button[type="submit"]').disabled = false;
  }
});

// Branche les boutons de guidage sur leurs fonctions.
startGuidanceButton.addEventListener('click', startGuidance);
stopGuidanceButton.addEventListener('click', stopGuidance);

/* ---------- 7. RECHERCHE D'UN LIEU (barre du haut) ---------- */

// Cherche un lieu par son nom et centre la carte dessus.
async function searchPlace(query) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    searchStatus.textContent = 'Saisissez une ville, un quartier ou une adresse.';
    searchInput.focus(); // remet le curseur dans le champ
    return;
  }

  searchStatus.textContent = 'Recherche en cours…';
  const params = new URLSearchParams({
    format: 'jsonv2',
    q: trimmedQuery,
    countrycodes: 'bj',
    limit: '1',
    'accept-language': 'fr'
  });

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
    if (!response.ok) throw new Error('search');
    const results = await response.json();
    if (results.length === 0) {
      searchStatus.textContent = 'Aucun résultat au Bénin. Essayez une autre recherche.';
      return;
    }

    const result = results[0];
    const latitude = Number(result.lat); // Nominatim renvoie du texte : Number() le convertit
    const longitude = Number(result.lon);
    const label = result.display_name.split(',').slice(0, 2).join(',');
    showPosition(latitude, longitude, label);
    locationName.textContent = label;
    locationDetail.textContent = 'Lieu trouvé au Bénin.';
    coordinates.hidden = true; // pas de coordonnées GPS : ce n'est pas la position de l'utilisateur
    accuracy.hidden = true;
    searchStatus.textContent = 'Lieu trouvé sur la carte.';
  } catch {
    searchStatus.textContent = 'Recherche indisponible. Vérifiez votre connexion et réessayez.';
  }
}

// Lance la recherche à l'envoi du formulaire (clic sur "Rechercher" ou touche Entrée).
searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  searchPlace(searchInput.value);
});

/* ---------- 8. VILLES PRINCIPALES (boutons de la liste) ---------- */
// Chaque bouton .place-item porte ses coordonnées dans index.html
// (data-lat, data-lon, data-name), lisibles ici avec button.dataset.
document.querySelectorAll('.place-item').forEach((button) => {
  button.addEventListener('click', () => {
    const latitude = Number(button.dataset.lat);
    const longitude = Number(button.dataset.lon);
    const name = button.dataset.name;
    showPosition(latitude, longitude, `${name}, Bénin`);
    locationName.textContent = name;
    locationDetail.textContent = 'Ville sélectionnée sur la carte.';
    coordinates.hidden = true;
    accuracy.hidden = true;
    searchStatus.textContent = `La carte est centrée sur ${name}.`;
  });
});

/* ---------- 9. BOUTON "ME LOCALISER" ---------- */
locateButton.addEventListener('click', () => {
  if (!('geolocation' in navigator)) {
    locationName.textContent = 'Géolocalisation indisponible';
    locationDetail.textContent = 'Ce navigateur ne permet pas de récupérer votre position.';
    return;
  }

  locateButton.disabled = true; // évite les clics répétés pendant l'attente
  locationName.textContent = 'Localisation en cours…';
  locationDetail.textContent = 'Autorisez l’accès à votre position dans le navigateur.';
  searchStatus.textContent = 'Récupération de votre position GPS…';

  // getCurrentPosition(succès, erreur, options) : le navigateur demande la permission
  // à l'utilisateur, puis appelle l'une des deux fonctions.
  navigator.geolocation.getCurrentPosition(async (position) => {
    // --- Succès ---
    const { latitude, longitude, withinBenin } = showUserPosition(position);
    locationDetail.textContent = 'Coordonnées GPS de votre appareil.';
    searchStatus.textContent = 'Votre position a été actualisée.';

    // Si on est au Bénin, on demande à Nominatim le nom du quartier/de la ville
    // ("géocodage inverse" : coordonnées -> adresse).
    if (withinBenin) {
      try {
        const params = new URLSearchParams({ format: 'jsonv2', lat: String(latitude), lon: String(longitude), 'accept-language': 'fr' });
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`);
        if (response.ok) {
          const result = await response.json();
          const address = result.address || {};
          // "||" prend la première valeur disponible, du plus précis au moins précis.
          const nearbyPlace = address.suburb || address.neighbourhood || address.village || address.town || address.city || address.county;
          if (nearbyPlace) {
            locationName.textContent = nearbyPlace;
            locationDetail.textContent = `${address.state || 'Bénin'} · coordonnées GPS de votre appareil.`;
            mapCaption.textContent = `${nearbyPlace}, Bénin`;
          }
        }
      } catch {
        // Les coordonnées restent affichées si l'adresse ne peut pas être résolue.
      }
    }

    locateButton.disabled = false;
  }, (error) => {
    // --- Erreur : error.code vaut 1, 2 ou 3 selon la cause ---
    locateButton.disabled = false;
    const messages = {
      1: 'Autorisation refusée. Autorisez la localisation dans les réglages du navigateur.',
      2: 'Position introuvable. Vérifiez le GPS ou réessayez à l’extérieur.',
      3: 'La demande a expiré. Réessayez dans un instant.'
    };
    locationName.textContent = 'Impossible de vous localiser';
    locationDetail.textContent = messages[error.code] || 'La localisation a échoué. Réessayez.';
    searchStatus.textContent = 'La localisation n’a pas abouti.';
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }); // maximumAge: 0 = toujours une position fraîche
});

/* ---------- 10. COORDONNÉES DU CENTRE DE LA CARTE ---------- */
// "moveend" se déclenche quand la carte finit de bouger (glisser, zoom...).
// On met alors à jour les coordonnées affichées en haut à droite de la carte.
map.on('moveend', () => {
  const center = map.getCenter();
  mapCoordinates.textContent = `${formatCoordinate(center.lat, 'N', 'S')}   ${formatCoordinate(center.lng, 'E', 'O')}`;
});
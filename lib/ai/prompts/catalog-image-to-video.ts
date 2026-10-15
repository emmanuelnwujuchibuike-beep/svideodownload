import { category, entries } from "./define";
import type { PromptCategory, PromptSuggestion } from "./schema";

/**
 * The Image to Video prompt library (owner's brief, 2026-10-15, §4). Different from Text to
 * Video on purpose: every prompt ANIMATES the uploaded photo — the video opens on it — and
 * keeps its subject, composition and look, rather than describing a new scene.
 *
 * ⚠️ Model limits these prompts respect (lib/ai/prompts/schema.ts WORKSPACE_CAPABILITIES):
 *   · the photo is always the first frame, so a "transformation" changes the subject DURING the
 *     clip; it cannot start the video already restyled (that is Text to Video with the photo as a
 *     reference image, said on those cards)
 *   · a reference video here guides motion only, so nothing here replaces a person in a video
 */

const M = "image_to_video" as const;

const KEEP =
  "Preserve the subject's identity, facial features, hairstyle, clothing, body proportions and the photo's original composition, colours and visual style. Keep the motion smooth and natural, the background consistent and the details stable, avoiding flicker, facial distortion, warped hands or unnecessary changes.";

const KEEP_SCENE =
  "Keep the photo's composition, colours, lighting style and every subject recognisable and stable, with smooth natural motion and no flicker, warping or new elements that were not in the image.";

const KEEP_PRODUCT =
  "Preserve the product's exact shape, colours, branding, proportions and distinctive design details. Keep it visually stable and recognisable throughout the clip, and avoid changing logos, adding unwanted text or distorting the product.";

const ANIMAL =
  "Preserve the animal's markings, colours, proportions and the photo's composition, with anatomically believable movement and no warping, extra limbs or flicker.";

const TRANSFORM_NOTE = "Opens on your photo, then transforms it during the clip.";

const ANIMATE = category(M, "animate", "Animate My Image", "Bring people in a photo to life", 1);
const TRANSFORM = category(M, "transformation", "Character Transformation", "Turn the subject into anime, 3D, fantasy and more", 2);
const CINEMATIC = category(M, "cinematic", "Cinematic Image Animation", "Camera moves, weather and light", 3);
const ANIMALS = category(M, "animals", "Animate Animals", "Pets and wildlife in motion", 4);
const PRODUCT = category(M, "product", "Marketing & Product", "Turn product photos into ads", 5);
const ANIME = category(M, "anime-cartoon", "Anime & Cartoon", "Animate drawings and characters", 6);
const NATURE = category(M, "nature", "Nature & Environment", "Water, sky, trees and seasons", 7);
const ACTION = category(M, "action", "Action & Adventure", "Heroic poses and dynamic motion", 8);

export const IMAGE_TO_VIDEO_CATEGORIES: PromptCategory[] = [ANIMATE, TRANSFORM, CINEMATIC, ANIMALS, PRODUCT, ANIME, NATURE, ACTION];

const animate = entries(M, ANIMATE, [
  {
    slug: "come-alive",
    title: "Make My Photo Come Alive",
    description: "Subtle, natural movement — blinking, breathing, a gentle expression.",
    featured: true,
    tags: ["photo", "alive", "portrait", "animate", "subtle"],
    prompt:
      "Animate the subject in the uploaded image with subtle, natural movements while preserving their identity, facial features, hairstyle, clothing, body proportions, and original visual style. Introduce gentle head movement, natural blinking, subtle facial expressions, and realistic breathing. Keep the original composition and background consistent. Use smooth motion and stable facial details, avoiding visual flicker, facial distortion, or unnecessary changes to the subject.",
  },
  {
    slug: "cinematic-portrait",
    title: "Cinematic Portrait Animation",
    description: "A film-like portrait with a slow push-in and soft light.",
    tags: ["portrait", "cinematic", "face", "film"],
    prompt: `Turn the uploaded portrait into a cinematic shot: a very slow camera push-in, the subject's eyes shifting slightly towards the lens, a soft breath and the faint movement of light across their face as if a cloud passes the sun. ${KEEP}`,
  },
  {
    slug: "head-eyes",
    title: "Natural Head and Eye Movement",
    description: "The subject looks around naturally and blinks.",
    tags: ["head", "eyes", "blink", "look around", "natural"],
    prompt: `Animate the person in the uploaded image looking slowly to one side, blinking naturally, and turning their head back to face the camera with a relaxed expression, with small realistic movements of the neck and shoulders. ${KEEP}`,
  },
  {
    slug: "smile",
    title: "Smile and Facial Expression",
    description: "A warm, natural smile spreads across the face.",
    tags: ["smile", "expression", "face", "happy"],
    prompt: `Animate the person in the uploaded image breaking into a warm, natural smile that reaches their eyes, with a slight tilt of the head and a soft laugh, keeping every facial feature true to the photo. ${KEEP}`,
  },
  {
    slug: "walking",
    title: "Walking Character",
    description: "The subject starts walking forward naturally.",
    tags: ["walking", "walk", "full body", "movement"],
    prompt: `Animate the person in the uploaded image walking forward at a relaxed pace with a natural gait, arms swinging gently and clothing moving with each step, as the camera tracks smoothly backwards in front of them. Extend the background naturally in the same style as the photo. ${KEEP}`,
  },
  {
    slug: "dancing",
    title: "Dancing Character",
    description: "The subject dances with smooth, joyful moves.",
    tags: ["dance", "dancing", "fun", "movement"],
    prompt: `Animate the person in the uploaded image dancing joyfully with smooth, rhythmic moves — swaying hips, shoulder rolls and a playful spin — with natural body mechanics and clothing that moves with them. ${KEEP}`,
  },
  {
    slug: "turn-to-camera",
    title: "Character Turns Toward Camera",
    description: "A slow, dramatic turn to face the viewer.",
    tags: ["turn", "camera", "dramatic", "reveal"],
    prompt: `Animate the subject in the uploaded image slowly turning their head and shoulders towards the camera, meeting the viewer's eyes with a confident, cinematic gaze, while the camera eases in gently. ${KEEP}`,
  },
  {
    slug: "wind-hair",
    title: "Wind Blowing Through Hair",
    description: "A breeze moves the hair and clothes beautifully.",
    tags: ["wind", "hair", "breeze", "flowing"],
    prompt: `Animate a gentle breeze blowing through the uploaded image: the subject's hair lifts and flows naturally, loose clothing ripples softly, and they close their eyes for a moment and smile into the wind. ${KEEP}`,
  },
  {
    slug: "clothing-motion",
    title: "Clothing Moving Naturally",
    description: "Fabric sways and folds as the subject shifts.",
    tags: ["clothing", "fabric", "fashion", "dress"],
    prompt: `Animate the clothing in the uploaded image moving naturally as the subject shifts their weight and turns slightly: fabric folds, sways and catches the light realistically, with a dress or jacket hem moving softly in the air. ${KEEP}`,
  },
  {
    slug: "looking-distance",
    title: "Character Looking Into the Distance",
    description: "A thoughtful gaze towards the horizon.",
    tags: ["looking", "distance", "thoughtful", "horizon"],
    prompt: `Animate the person in the uploaded image turning to look thoughtfully into the distance, their expression calm and reflective, with a slow breath, a slight drift of hair and the camera moving gently to the side. ${KEEP}`,
  },
]);

const transformation = entries(M, TRANSFORM, [
  {
    slug: "to-anime",
    title: "Photo to Anime",
    description: `${TRANSFORM_NOTE} The subject becomes an anime character.`,
    featured: true,
    tags: ["anime", "transformation", "manga", "style"],
    prompt: `Begin on the uploaded photo exactly as it is, then smoothly transform the subject and scene into a polished modern anime style over the clip — clean line art, cel-shaded colour, expressive eyes and stylised hair — while the subject keeps the same pose, outfit, hairstyle and recognisable features, ending with a subtle anime-style blink and smile. ${KEEP_SCENE}`,
  },
  {
    slug: "to-3d-cartoon",
    title: "Photo to 3D Cartoon",
    description: `${TRANSFORM_NOTE} The subject becomes a 3D animated character.`,
    tags: ["3d", "cartoon", "pixar style", "transformation"],
    prompt: `Begin on the uploaded photo, then smoothly transform the subject into a charming 3D animated cartoon character with soft rounded features, expressive eyes and high-quality materials, keeping the same pose, outfit colours and recognisable personality, and finish with a cheerful animated gesture. ${KEEP_SCENE}`,
  },
  {
    slug: "to-fantasy",
    title: "Human to Fantasy Character",
    description: `${TRANSFORM_NOTE} The subject becomes an elf, sorcerer or warrior.`,
    tags: ["fantasy", "elf", "transformation", "magic"],
    prompt: `Begin on the uploaded photo, then let soft magical light sweep over the subject as they gradually transform into a fantasy character — elegant pointed ears, ornate fantasy clothing and faint glowing markings — keeping their face, expression and pose recognisable throughout. ${KEEP_SCENE}`,
  },
  {
    slug: "hero",
    title: "Hero Transformation",
    description: `${TRANSFORM_NOTE} An everyday person becomes a hero.`,
    tags: ["hero", "transformation", "epic", "armour"],
    prompt: `Begin on the uploaded photo, then transform the subject into an epic hero as a burst of light rises around them: their clothing becomes detailed armour and a flowing cape while their stance grows confident and powerful, keeping their face and identity unchanged. ${KEEP_SCENE}`,
  },
  {
    slug: "magical",
    title: "Magical Character Transformation",
    description: `${TRANSFORM_NOTE} Sparkling magic changes the subject's look.`,
    tags: ["magic", "sparkle", "transformation", "fantasy"],
    prompt: `Begin on the uploaded photo, then surround the subject with swirling sparkles that wrap around them and transform their outfit into an elegant magical costume with shimmering fabric and glowing details, keeping their face, hair and pose recognisable. ${KEEP_SCENE}`,
  },
  {
    slug: "creature",
    title: "Fantasy Creature Transformation",
    description: `${TRANSFORM_NOTE} The subject gains creature features.`,
    tags: ["creature", "fantasy", "transformation", "monster"],
    prompt: `Begin on the uploaded photo, then gradually transform the subject into a majestic fantasy creature version of themselves — such as a dragon-scaled warrior or a forest spirit — with features emerging smoothly over the clip while their eyes, expression and pose stay recognisable. ${KEEP_SCENE}`,
  },
  {
    slug: "superhero",
    title: "Superhero Transformation",
    description: `${TRANSFORM_NOTE} An original suit forms around the subject.`,
    tags: ["superhero", "suit", "transformation", "hero"],
    prompt: `Begin on the uploaded photo, then show an original superhero suit forming over the subject panel by panel with glowing seams, finishing with a confident heroic pose. Do not copy any existing studio's hero, and keep the subject's face, build and identity unchanged. ${KEEP_SCENE}`,
  },
  {
    slug: "character-reveal",
    title: "Cinematic Character Reveal",
    description: "A dramatic light-and-camera reveal of the subject.",
    tags: ["reveal", "cinematic", "dramatic", "character"],
    prompt: `Animate a dramatic reveal of the subject in the uploaded image: the scene starts in shadow, a beam of light slowly sweeps across to reveal them, they lift their head towards the camera and the camera pushes in for a heroic close-up. ${KEEP}`,
  },
]);

const cinematic = entries(M, CINEMATIC, [
  {
    slug: "movie-scene",
    title: "Turn My Photo Into a Movie Scene",
    description: "Film-grade motion, light and atmosphere.",
    featured: true,
    tags: ["movie", "cinematic", "film", "scene"],
    prompt: `Turn the uploaded image into a cinematic movie shot: add subtle natural motion to people and elements in the scene, drifting atmospheric haze, gentle light changes and a slow, deliberate camera move that gives the photo depth and drama, as if it were a frame from a feature film. ${KEEP_SCENE}`,
  },
  {
    slug: "zoom",
    title: "Dramatic Camera Zoom",
    description: "A bold zoom into the heart of the image.",
    tags: ["zoom", "camera", "dramatic"],
    prompt: `Animate the uploaded image with a dramatic, smooth camera zoom towards its main subject, accelerating slightly in the middle and easing to a stop on a striking close-up, with subtle parallax between foreground and background. ${KEEP_SCENE}`,
  },
  {
    slug: "orbit",
    title: "Cinematic Camera Orbit",
    description: "The camera circles the subject in 3D.",
    tags: ["orbit", "rotate", "camera", "3d"],
    prompt: `Animate a slow cinematic camera orbit around the main subject of the uploaded image, revealing believable depth and a little of their sides as the background shifts naturally behind them, while the subject stays still or moves only slightly. ${KEEP_SCENE}`,
  },
  {
    slug: "push-in",
    title: "Slow Camera Push-In",
    description: "A gentle, emotional push towards the subject.",
    tags: ["push in", "dolly", "slow", "camera"],
    prompt: `Animate the uploaded image with a slow, steady camera push-in towards the main subject, adding a soft depth-of-field shift and faint atmospheric movement, for a calm and emotional cinematic feel. ${KEEP_SCENE}`,
  },
  {
    slug: "pull-back",
    title: "Camera Pull-Back Reveal",
    description: "Start close and pull back to reveal the scene.",
    tags: ["pull back", "reveal", "camera", "wide"],
    prompt: `Animate the uploaded image with a camera that starts close on the main subject and slowly pulls back to reveal more of the surrounding scene, extending the edges of the image naturally in the same style, lighting and perspective. ${KEEP_SCENE}`,
  },
  {
    slug: "parallax",
    title: "Parallax Depth Animation",
    description: "A 3D parallax effect from a flat photo.",
    tags: ["parallax", "3d", "depth", "2.5d"],
    prompt: `Animate the uploaded image with a gentle parallax depth effect: the foreground, subject and background separate into layers and shift at different speeds as the camera drifts slowly sideways, creating a convincing three-dimensional feel without changing the content. ${KEEP_SCENE}`,
  },
  {
    slug: "lighting-change",
    title: "Dramatic Lighting Change",
    description: "Light shifts across the scene for mood.",
    tags: ["lighting", "light", "mood", "dramatic"],
    prompt: `Animate a dramatic lighting change across the uploaded image: soft daylight slowly shifts into warm golden-hour light, shadows lengthen and move naturally across the subject and surroundings, with a subtle camera drift. ${KEEP_SCENE}`,
  },
  {
    slug: "rain",
    title: "Rainy Cinematic Scene",
    description: "Add falling rain, wet reflections and mood.",
    tags: ["rain", "weather", "moody", "cinematic"],
    prompt: `Animate rain falling across the uploaded image: realistic raindrops streak through the air, surfaces begin to glisten with wet reflections, small ripples form in puddles, and the light becomes a little moodier while the subject stays as in the photo. ${KEEP_SCENE}`,
  },
  {
    slug: "windy",
    title: "Windy Landscape",
    description: "Wind sweeps through grass, trees and clouds.",
    tags: ["wind", "landscape", "grass", "trees"],
    prompt: `Animate wind moving through the uploaded landscape: grass ripples in waves, branches and leaves sway, clouds drift across the sky and any water surface shimmers, with a slow, steady camera. ${KEEP_SCENE}`,
  },
  {
    slug: "sunset",
    title: "Sunset Animation",
    description: "The scene glides into a golden sunset.",
    tags: ["sunset", "golden hour", "sky", "light"],
    prompt: `Animate the uploaded image transitioning gently into sunset: the sky warms through gold and orange to soft pink, light and shadows shift naturally across the scene, and the sun sinks slowly while everything in the photo stays in place. ${KEEP_SCENE}`,
  },
  {
    slug: "fog",
    title: "Foggy Mystery Scene",
    description: "Rolling fog for a mysterious atmosphere.",
    tags: ["fog", "mist", "mystery", "atmosphere"],
    prompt: `Animate soft fog rolling slowly through the uploaded image, drifting between objects and around the subject, softening the background and creating a quiet, mysterious atmosphere, with a slow forward camera drift. ${KEEP_SCENE}`,
  },
  {
    slug: "landscape-reveal",
    title: "Epic Landscape Reveal",
    description: "A sweeping move that makes the landscape epic.",
    tags: ["landscape", "epic", "reveal", "aerial"],
    prompt: `Animate the uploaded landscape with an epic, rising camera movement that lifts and glides forward over the scene, clouds moving across the sky and light shifting over the land, giving the photo grand cinematic scale. ${KEEP_SCENE}`,
  },
]);

const animals = entries(M, ANIMALS, [
  {
    slug: "pet",
    title: "Animate My Pet",
    description: "Your pet blinks, looks around and wags or purrs.",
    featured: true,
    tags: ["pet", "dog", "cat", "animal", "cute"],
    prompt: `Animate the pet in the uploaded image with natural, characterful movement: blinking, ears twitching, head tilting curiously towards the camera, a wagging tail or a contented stretch, true to its species and personality. ${ANIMAL}`,
  },
  {
    slug: "lion-savannah",
    title: "Lion Walking in the Savannah",
    description: "A lion strides majestically through the grass.",
    tags: ["lion", "savannah", "wildlife", "africa"],
    prompt: `Animate the lion in the uploaded image walking slowly and majestically through the savannah grass, its mane moving in the breeze, shoulders rolling with each step, as the camera tracks alongside in golden light. ${ANIMAL}`,
  },
  {
    slug: "cat-playing",
    title: "Cat Playing",
    description: "A playful cat pounces and bats at something.",
    tags: ["cat", "kitten", "playing", "pet"],
    prompt: `Animate the cat in the uploaded image playing: crouching with a wiggle, pouncing playfully at something just out of frame and batting at it with a paw, with natural feline agility and expressions. ${ANIMAL}`,
  },
  {
    slug: "dog-running",
    title: "Dog Running",
    description: "A happy dog runs towards the camera.",
    tags: ["dog", "running", "happy", "pet"],
    prompt: `Animate the dog in the uploaded image running happily towards the camera, ears flopping and tongue out, paws striking the ground in a natural gait, with a smooth camera that keeps it in frame. ${ANIMAL}`,
  },
  {
    slug: "bird-flight",
    title: "Bird Taking Flight",
    description: "A bird spreads its wings and takes off.",
    tags: ["bird", "flight", "wings", "flying"],
    prompt: `Animate the bird in the uploaded image spreading its wings and taking flight, feathers flexing realistically as it beats its wings and rises gracefully out of frame, with the background staying as in the photo. ${ANIMAL}`,
  },
  {
    slug: "horse-running",
    title: "Horse Running",
    description: "A horse gallops with flowing mane.",
    tags: ["horse", "gallop", "running", "animal"],
    prompt: `Animate the horse in the uploaded image breaking into a powerful gallop, its mane and tail flowing, hooves kicking up dust or grass, as the camera tracks alongside with a sense of speed and freedom. ${ANIMAL}`,
  },
  {
    slug: "cartoon-dancing",
    title: "Cartoon Animal Dancing",
    description: "A cartoon animal busts some moves.",
    tags: ["cartoon", "animal", "dancing", "funny"],
    prompt: `Animate the cartoon animal in the uploaded image dancing playfully with bouncy, rhythmic moves, a little spin and a happy expression, in the same drawing or rendering style as the image. ${ANIMAL}`,
  },
  {
    slug: "baby-animal",
    title: "Baby Animal Playing",
    description: "A baby animal tumbles and explores.",
    tags: ["baby animal", "cute", "playing", "puppy", "kitten"],
    prompt: `Animate the baby animal in the uploaded image playing curiously: sniffing around, taking clumsy steps, tumbling gently and looking up at the camera with wide eyes, with soft, charming movement. ${ANIMAL}`,
  },
  {
    slug: "dragon",
    title: "Fantasy Dragon Moving",
    description: "A dragon stirs, breathes and spreads its wings.",
    tags: ["dragon", "fantasy", "wings", "creature"],
    prompt: `Animate the dragon in the uploaded image coming to life: it lifts its head, breathes out a curl of smoke, its scales catching the light, and slowly unfurls its great wings with a powerful, majestic motion. ${ANIMAL}`,
  },
  {
    slug: "wildlife",
    title: "Wildlife Image Animation",
    description: "Natural behaviour for any wild animal photo.",
    tags: ["wildlife", "nature", "animal", "documentary"],
    prompt: `Animate the wild animal in the uploaded image with natural, documentary-style behaviour appropriate to its species — grazing, watching its surroundings, a flick of the ears or tail, a slow step forward — with a subtle, steady camera and natural light. ${ANIMAL}`,
  },
]);

const product = entries(M, PRODUCT, [
  {
    slug: "product-photo",
    title: "Animate My Product Photo",
    description: "Turn a product photo into a premium commercial.",
    featured: true,
    tags: ["product", "commercial", "advert", "e-commerce", "marketing"],
    prompt:
      "Animate the product in the uploaded image into a premium commercial video. Preserve its original shape, colors, branding, proportions, and distinctive design details. Introduce a smooth cinematic camera movement, carefully controlled studio lighting, realistic reflections, and a refined background atmosphere. Keep the product visually stable and recognizable throughout the clip. Avoid changing logos, introducing unwanted text, or distorting the product.",
  },
  {
    slug: "luxury-reveal",
    title: "Luxury Product Reveal",
    description: "An elegant light sweep reveals the product.",
    tags: ["luxury", "reveal", "product", "premium"],
    prompt: `Animate a luxury reveal of the product in the uploaded image: the scene dims, a slow beam of light sweeps across the product revealing its contours and materials, delicate particles drift through the light and the camera glides in to a hero close-up. ${KEEP_PRODUCT}`,
  },
  {
    slug: "smartphone",
    title: "Smartphone Commercial",
    description: "A sleek tech-ad treatment for a phone.",
    tags: ["smartphone", "phone", "tech", "commercial"],
    prompt: `Animate the smartphone in the uploaded image as a sleek tech commercial: it rotates slowly in space, light gliding across the glass and metal edges, the screen glowing softly, with a clean gradient background and precise reflections. ${KEEP_PRODUCT}`,
  },
  {
    slug: "fashion-model",
    title: "Fashion Model Animation",
    description: "The model poses and moves like a campaign film.",
    tags: ["fashion", "model", "campaign", "clothing"],
    prompt: `Animate the model in the uploaded fashion image as a campaign film: a subtle shift of pose, a confident turn of the head, fabric moving naturally and a slow camera drift, keeping the outfit's cut, colours, patterns and logos exactly as in the photo. ${KEEP}`,
  },
  {
    slug: "shoe",
    title: "Shoe Advertisement",
    description: "A dynamic sneaker or shoe ad.",
    tags: ["shoe", "sneaker", "footwear", "advertisement"],
    prompt: `Animate the shoe in the uploaded image as a dynamic advertisement: the camera orbits it closely, light catches the stitching and materials, and a burst of dust or water droplets in slow motion adds energy around it. ${KEEP_PRODUCT}`,
  },
  {
    slug: "perfume",
    title: "Perfume Bottle Reveal",
    description: "Mist, petals and light around a fragrance.",
    tags: ["perfume", "fragrance", "bottle", "luxury"],
    prompt: `Animate the perfume bottle in the uploaded image with a delicate reveal: soft mist drifts around it, a few petals fall in slow motion, light refracts through the glass and the liquid shimmers gently as the camera moves slowly closer. ${KEEP_PRODUCT}`,
  },
  {
    slug: "jewelry",
    title: "Jewelry Showcase",
    description: "Sparkle and shine on rings, necklaces and more.",
    tags: ["jewelry", "jewellery", "ring", "necklace", "luxury"],
    prompt: `Animate the jewellery in the uploaded image as an elegant showcase: light sweeps across the piece, gemstones sparkle with realistic refractions, metal gleams, and the camera moves in a slow, close arc against a soft dark background. ${KEEP_PRODUCT}`,
  },
  {
    slug: "food",
    title: "Restaurant Food Commercial",
    description: "Steam, sizzle and appetite appeal.",
    tags: ["food", "restaurant", "dish", "commercial"],
    prompt: `Animate the dish in the uploaded image as a mouth-watering food commercial: gentle steam rises, sauces glisten, a garnish settles in slow motion and the camera pushes in slowly in warm, appetising light, keeping the food and plating exactly as photographed. ${KEEP_SCENE}`,
  },
  {
    slug: "rotation",
    title: "Product Rotation",
    description: "A smooth 360° turntable spin.",
    tags: ["rotation", "360", "turntable", "product"],
    prompt: `Animate the product in the uploaded image rotating smoothly on a turntable, completing a slow turn that shows its form, while studio light moves naturally across its surfaces against a clean background. Infer unseen sides conservatively and consistently with the visible design. ${KEEP_PRODUCT}`,
  },
  {
    slug: "ecommerce",
    title: "E-commerce Product Animation",
    description: "A clean, clear animation for an online store.",
    tags: ["e-commerce", "ecommerce", "shop", "product", "listing"],
    prompt: `Animate the product in the uploaded image for an online store: a gentle float and slow camera move highlight its key details one after another, in bright, even lighting on a clean background, finishing on a sharp front view. ${KEEP_PRODUCT}`,
  },
]);

const anime = entries(M, ANIME, [
  {
    slug: "anime-alive",
    title: "Anime Character Comes Alive",
    description: "An anime drawing blinks, breathes and moves.",
    featured: true,
    tags: ["anime", "character", "manga", "drawing"],
    prompt: `Animate the anime character in the uploaded image coming to life in its exact art style: hair and clothing swaying, a natural blink, a soft breath and a small expressive change, with gentle anime-style background motion such as drifting petals or clouds. Keep the line art, colours and character design identical to the image, with no flicker or style drift.`,
  },
  {
    slug: "cartoon-movement",
    title: "Cartoon Character Movement",
    description: "A cartoon character waves, walks or reacts.",
    tags: ["cartoon", "character", "animation", "drawing"],
    prompt: `Animate the cartoon character in the uploaded image with lively, expressive movement — a wave, a few bouncy steps and a big friendly reaction — in exactly the same drawing style, colours and proportions as the image, with no flicker or style drift.`,
  },
  {
    slug: "anime-action",
    title: "Anime Action Scene",
    description: "Speed lines, energy and a dynamic attack.",
    tags: ["anime", "action", "fight", "energy"],
    prompt: `Animate the anime character in the uploaded image launching into a dynamic action moment: a powerful stance, energy aura flaring, hair and clothing whipping in the wind and speed lines streaking past, in the same art style as the image. Keep the character design consistent from the first frame to the last.`,
  },
  {
    slug: "anime-transformation",
    title: "Magical Anime Transformation",
    description: `${TRANSFORM_NOTE} A sparkling magical-girl-style sequence.`,
    tags: ["anime", "magical", "transformation", "sparkle"],
    prompt: `Begin on the uploaded anime image, then animate a magical transformation sequence: ribbons of light and sparkles swirl around the character, their outfit changes into an ornate magical costume and they finish with a confident pose, all in the image's own anime art style and with the character's face and hair unchanged.`,
  },
  {
    slug: "cartoon-animal",
    title: "Cartoon Animal Adventure",
    description: "A cartoon animal sets off on an adventure.",
    tags: ["cartoon", "animal", "adventure", "kids"],
    prompt: `Animate the cartoon animal in the uploaded image setting off on a little adventure: it looks around excitedly, hops forward along a path and turns back to the camera with a big grin, in exactly the image's drawing style and colours. ${ANIMAL}`,
  },
  {
    slug: "fantasy-character",
    title: "Fantasy Character Animation",
    description: "A fantasy illustration stirs with magic.",
    tags: ["fantasy", "illustration", "character", "magic"],
    prompt: `Animate the fantasy character in the uploaded illustration: their cloak and hair move in a magical wind, glowing runes or particles drift around them and they raise their weapon or staff slowly, preserving the illustration's painting style, palette and character design.`,
  },
  {
    slug: "storybook",
    title: "Animated Storybook Scene",
    description: "A storybook illustration gently comes to life.",
    tags: ["storybook", "illustration", "kids", "fairy tale"],
    prompt: `Animate the storybook illustration in the uploaded image as if the page were coming to life: characters move gently, leaves flutter, smoke curls from chimneys and light glows softly, in exactly the illustration's hand-drawn style and colours, with calm, charming motion.`,
  },
  {
    slug: "cute-dancing",
    title: "Cute Character Dancing",
    description: "A cute character does a happy little dance.",
    tags: ["cute", "dancing", "character", "chibi"],
    prompt: `Animate the cute character in the uploaded image doing a happy little dance — bouncing side to side, waving its arms and finishing with a sweet pose — in exactly the image's style, colours and proportions, with smooth, loopable motion.`,
  },
]);

const nature = entries(M, NATURE, [
  {
    slug: "waterfall",
    title: "Animate a Waterfall",
    description: "Water flows, mist rises and the scene breathes.",
    tags: ["waterfall", "water", "nature", "flow"],
    prompt: `Animate the waterfall in the uploaded image: water cascades and flows realistically, mist rises from the base, the pool ripples and nearby leaves sway gently, with a slow, steady camera. ${KEEP_SCENE}`,
  },
  {
    slug: "ocean-waves",
    title: "Ocean Waves in Motion",
    description: "Waves roll and break along the shore.",
    tags: ["ocean", "waves", "sea", "beach"],
    prompt: `Animate the ocean in the uploaded image: waves roll in and break gently along the shore, foam spreading across the sand, light glittering on the water and clouds drifting slowly overhead. ${KEEP_SCENE}`,
  },
  {
    slug: "clouds",
    title: "Clouds Moving Across the Sky",
    description: "Clouds drift and shadows travel across the land.",
    tags: ["clouds", "sky", "time-lapse", "weather"],
    prompt: `Animate the sky in the uploaded image with clouds drifting steadily across it in a gentle time-lapse, their shadows travelling over the landscape below, while the rest of the scene stays still and stable. ${KEEP_SCENE}`,
  },
  {
    slug: "trees",
    title: "Trees Swaying in the Wind",
    description: "Branches and leaves move in a soft breeze.",
    tags: ["trees", "wind", "leaves", "forest"],
    prompt: `Animate the trees in the uploaded image swaying in a soft breeze, leaves rustling and catching the light, with dappled sunlight shifting on the ground beneath them. ${KEEP_SCENE}`,
  },
  {
    slug: "flowers",
    title: "Flowers Blooming",
    description: "Buds open into full bloom.",
    tags: ["flowers", "bloom", "time-lapse", "garden"],
    prompt: `Animate the flowers in the uploaded image blooming in a smooth time-lapse: buds slowly unfurl into full petals, stems lift towards the light and a few petals tremble in the breeze. ${KEEP_SCENE}`,
  },
  {
    slug: "rain-city",
    title: "Rainfall on a City",
    description: "Rain, reflections and city lights.",
    tags: ["rain", "city", "night", "reflections"],
    prompt: `Animate rain falling on the city in the uploaded image: raindrops streak past street lights, roads and pavements gain glossy reflections, puddles ripple and lights glow softly through the wet air. ${KEEP_SCENE}`,
  },
  {
    slug: "snow",
    title: "Snowfall Animation",
    description: "Soft snow drifts down over the scene.",
    tags: ["snow", "winter", "snowfall", "christmas"],
    prompt: `Animate gentle snow falling across the uploaded image, flakes drifting at different depths and speeds and settling lightly on surfaces, with a calm winter atmosphere and a very slow camera drift. ${KEEP_SCENE}`,
  },
  {
    slug: "clouds-sunset",
    title: "Clouds and Sunset",
    description: "Glowing clouds drift as the sun goes down.",
    tags: ["sunset", "clouds", "sky", "golden hour"],
    prompt: `Animate the uploaded image with glowing sunset clouds drifting slowly across the sky, colours deepening from gold to rose and violet, and warm light fading gently over the landscape. ${KEEP_SCENE}`,
  },
  {
    slug: "landscape-time-lapse",
    title: "Landscape Time-Lapse",
    description: "Light, shadow and sky racing across the land.",
    tags: ["time-lapse", "landscape", "timelapse", "day"],
    prompt: `Animate the uploaded landscape as a time-lapse: clouds race across the sky, shadows sweep over hills and fields, and the light shifts smoothly through the day, while the land itself stays stable. ${KEEP_SCENE}`,
  },
  {
    slug: "magical-forest",
    title: "Magical Forest Animation",
    description: "Fireflies, glow and drifting magic.",
    tags: ["magical", "forest", "fireflies", "fantasy"],
    prompt: `Animate the forest in the uploaded image with a magical atmosphere: fireflies drift between the trees, soft glowing particles float upwards, gentle mist rolls along the ground and leaves sway in a light breeze. ${KEEP_SCENE}`,
  },
]);

const action = entries(M, ACTION, [
  {
    slug: "battle-ready",
    title: "Hero Prepares for Battle",
    description: "The subject readies for an epic fight.",
    featured: true,
    tags: ["hero", "battle", "epic", "warrior"],
    prompt: `Animate the subject in the uploaded image preparing for battle: they tighten their grip, take a determined breath, their clothing and hair stir in a rising wind, and the camera pushes in on a fierce, focused expression. ${KEEP}`,
  },
  {
    slug: "running-camera",
    title: "Character Running Toward Camera",
    description: "An intense, cinematic run straight at the lens.",
    tags: ["running", "run", "action", "camera"],
    prompt: `Animate the subject in the uploaded image running towards the camera with intensity and purpose, natural running mechanics, clothing and hair moving with the motion, and the camera pulling back to keep them in frame. ${KEEP}`,
  },
  {
    slug: "action-pose",
    title: "Dramatic Action Pose",
    description: "A dynamic move that lands in a striking pose.",
    tags: ["pose", "action", "dramatic", "dynamic"],
    prompt: `Animate the subject in the uploaded image moving dynamically into a dramatic action pose, with a short burst of wind and dust around them and a low camera angle that makes the moment heroic. ${KEEP}`,
  },
  {
    slug: "sword",
    title: "Sword-Wielding Fantasy Character",
    description: "A warrior draws and swings a sword.",
    tags: ["sword", "fantasy", "warrior", "knight"],
    prompt: `Animate the character in the uploaded image drawing a sword and swinging it in a graceful, controlled arc, the blade catching the light, cloak and hair moving with the motion, ending in a ready stance. ${KEEP}`,
  },
  {
    slug: "martial-arts",
    title: "Martial Arts Movement",
    description: "Precise strikes and a controlled stance.",
    tags: ["martial arts", "kung fu", "karate", "fight"],
    prompt: `Animate the subject in the uploaded image performing a short, precise martial-arts sequence — a fluid block, a fast strike and a return to a balanced stance — with realistic body mechanics and clothing that moves with each motion. ${KEEP}`,
  },
  {
    slug: "superhero-landing",
    title: "Superhero Landing",
    description: "A ground-shaking hero landing.",
    tags: ["superhero", "landing", "hero", "action"],
    prompt: `Animate the subject in the uploaded image completing a superhero landing: they drop into frame onto one knee, the ground cracks and dust bursts outwards in slow motion, and they rise slowly to face the camera. ${KEEP}`,
  },
  {
    slug: "escape-explosion",
    title: "Character Escapes an Explosion",
    description: "A dramatic escape with a fireball behind.",
    tags: ["explosion", "escape", "action", "blockbuster"],
    prompt: `Animate the subject in the uploaded image running or leaping away from a large explosion that erupts behind them, debris and sparks flying in slow motion and warm firelight washing over them, with realistic fire and smoke. ${KEEP}`,
  },
  {
    slug: "chase",
    title: "Cinematic Chase Scene",
    description: "The subject sprints in a tense chase.",
    tags: ["chase", "pursuit", "action", "thriller"],
    prompt: `Animate the subject in the uploaded image in a tense chase: they glance back over their shoulder and break into a sprint, the camera tracking alongside with energetic but smooth movement and motion blur in the background. ${KEEP}`,
  },
]);

export const IMAGE_TO_VIDEO_PROMPTS: PromptSuggestion[] = [...animate, ...transformation, ...cinematic, ...animals, ...product, ...anime, ...nature, ...action];

import { category, entries } from "./define";
import type { PromptCategory, PromptSuggestion } from "./schema";

/**
 * The Text to Video prompt library (owner's brief, 2026-10-15, §3). Every entry is a complete
 * prompt a member can generate from as it stands; shared closing sentences keep each category
 * consistent (continuity, the artefacts to avoid) without repeating them by hand.
 *
 * The model makes one short clip (3–15 s, a minute when the admin enables it), so story prompts
 * are written as ONE compelling scene from a larger film, never as a full multi-scene movie with
 * dialogue the clip cannot hold.
 */

const M = "text_to_video" as const;

/* ───────────────────────────── shared closings ───────────────────────────── */

const KEEP_REFERENCE =
  "Preserve the original character's body movements, gestures, timing, camera movement, scene composition and interaction with the environment as closely as the model allows. Integrate the new character naturally with consistent lighting, realistic shadows, accurate proportions and coherent motion, keep the original background and every other element of the scene, and avoid flickering, facial distortion, duplicated limbs, identity changes between frames and abrupt transitions.";

const ONE_SCENE =
  "Frame it as one continuous, compelling scene from a larger film rather than a complete story: a clear opening image, a moment of rising tension or emotion, and a striking final shot. Keep every character's face, clothing and proportions and the setting consistent from the first frame to the last.";

const ANIMATED =
  "Keep the character designs, colours and proportions consistent in every frame, with smooth, appealing animation, cinematic camera movement and a warm, family-friendly tone.";

const CRAFT =
  "Use professional lighting, smooth and deliberate camera movement, rich detail and consistent subjects throughout, with no flicker, warped shapes or sudden visual changes.";

/* ───────────────────────────── categories ───────────────────────────── */

const CHARACTER = category(M, "character-replacement", "Character Replacement", "Swap the person in a video, or star a new character", 1);
const MOVIES = category(M, "short-movies", "Short Movies", "One cinematic scene from a film of your choice", 2);
const ANIMALS = category(M, "animal-kingdom", "Animal Kingdom & Cartoons", "Animated animal worlds and real wildlife", 3);
const CINEMATIC = category(M, "cinematic-vfx", "Cinematic & Visual Effects", "Intros, reveals, slow motion and effects", 4);
const SOCIAL = category(M, "social-viral", "Social Media & Viral", "Skits, reels and scroll-stopping moments", 5);
const FASHION = category(M, "fashion-lifestyle", "Fashion & Lifestyle", "Campaigns, portraits and luxury scenes", 6);
const NATURE = category(M, "nature-travel", "Nature & Travel", "Landscapes, oceans, wildlife and space", 7);
const MUSIC = category(M, "music-performance", "Music & Performance", "Music videos, dance and stage", 8);
const BUSINESS = category(M, "business-advertising", "Business & Advertising", "Product ads, launches and brand films", 9);

export const TEXT_TO_VIDEO_CATEGORIES: PromptCategory[] = [CHARACTER, MOVIES, ANIMALS, CINEMATIC, SOCIAL, FASHION, NATURE, MUSIC, BUSINESS];

/* ─────────────────────── A · character replacement ─────────────────────── */

const characterReplacement = entries(M, CHARACTER, [
  {
    slug: "reference-video",
    title: "Character Replace — Reference Video",
    description: "Replace the person in your reference video, keeping its movement and scene. Add the video, and a reference image of the new character.",
    needs: "video",
    edit: true,
    featured: true,
    tags: ["character replacement", "swap", "reference video", "face", "person"],
    prompt:
      "Replace the original main character in the reference video with the character specified by the user or provided in the reference image. Preserve the original character's body movements, gestures, timing, camera movement, scene composition, and interaction with the environment as closely as the selected model allows. Integrate the replacement naturally into the scene with consistent lighting, realistic shadows, accurate proportions, and coherent motion. Maintain the original background and other scene elements. Avoid flickering, facial distortion, duplicated limbs, identity inconsistencies, and abrupt visual transitions.",
  },
  {
    slug: "new-scene",
    title: "Character Replace — New Scene",
    description: "Star your character in a brand-new scene, no reference video needed. Add a reference image of the character.",
    needs: "image",
    tags: ["character", "new scene", "reference image", "consistent character"],
    prompt:
      "Create a cinematic video featuring the specified character as the main subject in a newly generated scene. Give the character natural body movement, believable facial expressions, realistic interactions with the environment, and consistent appearance throughout the video. Use a visually coherent background, professional lighting, smooth camera movement, and natural transitions. Maintain the character's defining facial features, clothing, hairstyle, and body proportions across every frame.",
  },
  {
    slug: "anime",
    title: "Character Replace — Anime Character",
    description: "Turn the person in your reference video into an anime character with the same moves.",
    needs: "video",
    edit: true,
    tags: ["anime", "character replacement", "reference video", "manga", "japanese animation"],
    prompt: `Replace the main person in the reference video with an anime character drawn in a polished modern Japanese animation style: clean line art, expressive large eyes, stylised hair with crisp highlights and cel-shaded colour, matching the outfit and personality described by the user or shown in the reference image. ${KEEP_REFERENCE}`,
  },
  {
    slug: "realistic-human",
    title: "Character Replace — Realistic Human",
    description: "Swap in a photorealistic person who moves exactly like the original.",
    needs: "video",
    edit: true,
    tags: ["realistic", "human", "photorealistic", "character replacement", "reference video"],
    prompt: `Replace the main person in the reference video with a photorealistic human character as described by the user or shown in the reference image, with natural skin texture, believable hair, realistic eyes and clothing that folds and moves with the body. ${KEEP_REFERENCE}`,
  },
  {
    slug: "fantasy",
    title: "Character Replace — Fantasy Character",
    description: "Turn the person into an elf, a sorcerer or a warrior from another world.",
    needs: "video",
    edit: true,
    tags: ["fantasy", "elf", "wizard", "warrior", "character replacement", "reference video"],
    prompt: `Replace the main person in the reference video with a fantasy character such as an elven ranger, a sorcerer or an armoured warrior, as described by the user or shown in the reference image, with detailed costume materials, believable armour or robes, and subtle magical touches like faint glowing runes that never hide the character's movement. ${KEEP_REFERENCE}`,
  },
  {
    slug: "superhero",
    title: "Character Replace — Superhero",
    description: "Give the person in your video an original superhero look and suit.",
    needs: "video",
    edit: true,
    tags: ["superhero", "hero", "suit", "character replacement", "reference video"],
    prompt: `Replace the main person in the reference video with an original superhero in a sleek, well-fitted suit with a distinctive emblem, colour scheme and textured materials as described by the user or shown in the reference image. Do not copy an existing studio's hero. Add a heroic presence through posture and lighting while keeping the original action exactly as performed. ${KEEP_REFERENCE}`,
  },
  {
    slug: "historical",
    title: "Character Replace — Historical Character",
    description: "Recast the person as a figure from another era, in authentic costume.",
    needs: "video",
    edit: true,
    tags: ["historical", "period", "costume", "era", "character replacement", "reference video"],
    prompt: `Replace the main person in the reference video with a fictional character from the historical period chosen by the user, such as an ancient West African royal, a Roman soldier or a Victorian aristocrat, wearing accurate period clothing, hairstyle and accessories rendered with authentic fabrics and craftsmanship. ${KEEP_REFERENCE}`,
  },
  {
    slug: "3d-cartoon",
    title: "Character Replace — 3D Cartoon Character",
    description: "Turn the person into a polished 3D animated character, same performance.",
    needs: "video",
    edit: true,
    tags: ["3d", "cartoon", "pixar style", "animated", "character replacement", "reference video"],
    prompt: `Replace the main person in the reference video with a polished 3D animated cartoon character with appealing stylised proportions, soft rounded shapes, expressive eyes and high-quality materials, as described by the user or shown in the reference image, while the rest of the real scene stays as it is. ${KEEP_REFERENCE}`,
  },
  {
    slug: "celebrity-inspired",
    title: "Character Replace — Celebrity-Inspired Fictional Character",
    description: "A fictional star with a celebrity-style glamour, never a real person's likeness.",
    needs: "video",
    edit: true,
    tags: ["celebrity", "star", "glamour", "fictional", "character replacement", "reference video"],
    prompt: `Replace the main person in the reference video with an original fictional star: a confident, camera-ready character with red-carpet styling, a signature look and polished grooming, as described by the user. The character must be an invented person and must not resemble or imitate any real, identifiable celebrity. ${KEEP_REFERENCE}`,
  },
  {
    slug: "animal",
    title: "Character Replace — Animal Character",
    description: "Replace the person with an expressive animal that performs the same moves.",
    needs: "video",
    edit: true,
    tags: ["animal", "anthropomorphic", "character replacement", "reference video", "funny"],
    prompt: `Replace the main person in the reference video with an expressive animal character, such as a lion, a fox or a panda, as described by the user or shown in the reference image, standing and moving like the original performer with believable fur, natural animal features and readable facial expressions. ${KEEP_REFERENCE}`,
  },
  {
    slug: "multiple",
    title: "Character Replace — Multiple Characters",
    description: "Replace two or more people in your video. Add one reference image per character.",
    needs: "image-and-video",
    edit: true,
    tags: ["multiple characters", "group", "two people", "character replacement", "reference video", "reference image"],
    prompt: `Replace each person in the reference video with the matching character from the reference images, in order from left to right as they first appear, keeping every character distinct and never blending their faces, clothing or body types together. Each replacement keeps the position, movement and interactions of the person it replaces. ${KEEP_REFERENCE}`,
  },
  {
    slug: "villain",
    title: "Character Replace — Cinematic Villain",
    description: "Turn the person into a menacing movie villain with dramatic lighting.",
    needs: "video",
    edit: true,
    tags: ["villain", "dark", "cinematic", "character replacement", "reference video"],
    prompt: `Replace the main person in the reference video with a menacing cinematic villain as described by the user or shown in the reference image: a commanding presence, a dark tailored costume or armour, sharp features and an intense gaze, with moodier, high-contrast lighting on the character that still matches the scene's light direction. ${KEEP_REFERENCE}`,
  },
]);

/* ───────────────────────────── B · short movies ───────────────────────────── */

const shortMovies = entries(M, MOVIES, [
  {
    slug: "cinematic",
    title: "Short Cinematic Movie",
    description: "A moody, beautifully shot moment from a feature film.",
    featured: true,
    tags: ["cinematic", "film", "drama", "short film"],
    prompt: `Create a cinematic moment from a feature film: a lone protagonist walks through a rain-washed city street at night, neon reflections shimmering in puddles, pausing as they notice something that changes their plans. Use an anamorphic widescreen look, shallow depth of field, a slow dolly forward and a final close-up on their face. ${ONE_SCENE}`,
  },
  {
    slug: "romantic",
    title: "Short Romantic Movie",
    description: "A tender, golden-hour moment between two people.",
    tags: ["romance", "love", "couple", "romantic"],
    prompt: `Create a tender romantic film scene of two people meeting again on a quiet rooftop at golden hour, the city glowing behind them. Show hesitant smiles, a gentle step closer and hands almost touching, captured with soft backlight, warm tones, a slow orbiting camera and lingering close-ups of their expressions. ${ONE_SCENE}`,
  },
  {
    slug: "action",
    title: "Short Action Movie",
    description: "A high-energy escape, choreographed like a blockbuster.",
    featured: true,
    tags: ["action", "chase", "fight", "escape", "blockbuster"],
    prompt:
      "Create a high-energy cinematic action sequence featuring a skilled protagonist escaping a dangerous situation in a visually striking urban environment. Begin with an establishing shot, followed by dynamic tracking shots, rapid but coherent character movements, dramatic close-ups, and carefully choreographed action. Use realistic environmental interactions, cinematic lighting, atmospheric depth, and professional action-film composition. Maintain the protagonist's appearance, clothing, and physical continuity throughout the sequence. Make the scene visually engaging, believable, and suitable for a professional short-film production.",
  },
  {
    slug: "horror",
    title: "Short Horror Movie",
    description: "Slow, suspenseful dread in an isolated place at night.",
    tags: ["horror", "scary", "suspense", "thriller", "night"],
    prompt:
      "Create a suspenseful cinematic horror sequence in an isolated location at night. Establish an unsettling atmosphere through carefully controlled lighting, deep shadows, subtle environmental movement, and slow camera reveals. Introduce a mysterious presence and build tension through the protagonist's reactions and the gradual discovery of something unexpected. Use coherent character movement, consistent environments, and professional horror-film composition. Prioritize suspense and psychological tension rather than relying exclusively on sudden scares.",
  },
  {
    slug: "comedy",
    title: "Short Comedy Movie",
    description: "A well-timed visual gag with a big reaction.",
    tags: ["comedy", "funny", "humor", "gag"],
    prompt: `Create a light-hearted comedy film scene in a busy office kitchen: a confident character tries to impress a colleague by flipping a pancake, which lands somewhere completely unexpected. Build the gag with clear staging, a beat of anticipation, the surprise and a perfectly timed reaction shot, using bright natural lighting, readable expressions and steady comedic framing. ${ONE_SCENE}`,
  },
  {
    slug: "science-fiction",
    title: "Short Science Fiction Movie",
    description: "A discovery aboard a vast spacecraft or in a future city.",
    tags: ["science fiction", "sci-fi", "future", "spaceship", "technology"],
    prompt: `Create a science-fiction film scene aboard a vast research spacecraft: an engineer in a practical spacesuit walks along a curved observation deck as a strange signal lights up a holographic console, then turns to the window as an unknown structure drifts into view. Use cool blue and amber lighting, realistic technology design, a slow push-in and a breathtaking final wide shot. ${ONE_SCENE}`,
  },
  {
    slug: "fantasy",
    title: "Short Fantasy Movie",
    description: "A magical discovery in an enchanted realm.",
    tags: ["fantasy", "magic", "enchanted", "kingdom"],
    prompt: `Create a fantasy film scene in an enchanted kingdom: a young traveller in a weathered cloak enters an ancient forest temple, where floating lanterns awaken and reveal a glowing artefact on a stone altar. Use painterly golden light, drifting particles, detailed architecture and a sweeping crane shot that ends on the traveller's awed face. ${ONE_SCENE}`,
  },
  {
    slug: "adventure",
    title: "Short Adventure Movie",
    description: "An explorer on the edge of a great discovery.",
    tags: ["adventure", "explorer", "treasure", "jungle"],
    prompt: `Create an adventure film scene of an explorer crossing a rope bridge above a misty jungle gorge towards the ruins of a hidden city, pausing as a section of the bridge gives way and steadying themselves before pressing on. Use lush greens, sun rays through the canopy, sweeping aerial shots and tense close-ups on hands and feet. ${ONE_SCENE}`,
  },
  {
    slug: "mystery",
    title: "Short Mystery Movie",
    description: "A detective notices the clue everyone else missed.",
    tags: ["mystery", "detective", "investigation", "clue"],
    prompt: `Create a mystery film scene in a dim, wood-panelled study: a sharp-eyed detective examines the room by lamplight, notices a small detail out of place on the bookshelf and slowly reveals a hidden compartment. Use moody low-key lighting, dust in the light beams, deliberate camera moves that guide the eye and a satisfying close-up on the discovery. ${ONE_SCENE}`,
  },
  {
    slug: "crime-thriller",
    title: "Short Crime Thriller",
    description: "A tense handover in a rain-soaked car park.",
    tags: ["crime", "thriller", "heist", "noir", "tense"],
    prompt: `Create a crime-thriller film scene in an underground car park on a rainy night: two figures meet beside a car for a tense handover of a briefcase, until headlights sweep across them and both freeze. Use a cool desaturated palette, hard practical lights, slow tracking shots and tight, nervous close-ups. ${ONE_SCENE}`,
  },
  {
    slug: "emotional-drama",
    title: "Short Emotional Drama",
    description: "A quiet, powerful moment of reconciliation.",
    tags: ["drama", "emotional", "family", "heartfelt"],
    prompt: `Create an emotional drama scene in a modest family home: an adult child returns after years away and finds an elderly parent at the kitchen table, and after a long silence they share a tearful embrace. Use soft window light, a restrained handheld camera, natural performances and close-ups that let the emotion breathe. ${ONE_SCENE}`,
  },
  {
    slug: "post-apocalyptic",
    title: "Short Post-Apocalyptic Movie",
    description: "A survivor in a reclaimed, overgrown world.",
    tags: ["post-apocalyptic", "dystopia", "survival", "ruins"],
    prompt: `Create a post-apocalyptic film scene of a lone survivor in patched gear walking through an overgrown city where vines cover rusted cars and broken towers, stopping when a faint radio signal crackles to life in their hand. Use dusty golden light, a muted earthy palette, wide desolate compositions and a final close-up of hope on their face. ${ONE_SCENE}`,
  },
  {
    slug: "historical",
    title: "Short Historical Movie",
    description: "A pivotal moment brought to life in authentic detail.",
    tags: ["historical", "period", "history", "epic"],
    prompt: `Create a historical film scene set in a bustling ancient market city at dawn: a messenger on horseback arrives with urgent news, and the crowd parts as a ruler steps onto a balcony to receive it. Use authentic period costume, architecture and props, warm morning haze, a sweeping crane shot and respectful, accurate cultural detail. ${ONE_SCENE}`,
  },
  {
    slug: "superhero",
    title: "Short Superhero Movie",
    description: "An original hero arrives just in time.",
    tags: ["superhero", "hero", "powers", "rescue", "action"],
    prompt: `Create a superhero film scene of an original hero in a distinctive suit landing on a city street to stop a runaway tram, bracing against it as sparks fly and bringing it to a halt inches from a crowd. Do not copy any existing studio's characters. Use dynamic low angles, slow motion at the peak moment, realistic debris and dramatic sunset lighting. ${ONE_SCENE}`,
  },
  {
    slug: "martial-arts",
    title: "Short Martial Arts Movie",
    description: "A graceful, precisely choreographed duel.",
    tags: ["martial arts", "kung fu", "fight", "duel", "action"],
    prompt: `Create a martial-arts film scene of two masters dueling in a bamboo forest at dawn, their movements precise and fluid, leaves swirling around them with every strike and block. Use clear choreography readable at every moment, a mix of wide shots and slow-motion details, soft green light and mist between the stalks. ${ONE_SCENE}`,
  },
  {
    slug: "survival",
    title: "Short Survival Movie",
    description: "One person against the elements.",
    tags: ["survival", "wilderness", "storm", "snow"],
    prompt: `Create a survival film scene of a mountaineer struggling through a snowstorm on a high ridge, wind tearing at their jacket, finding shelter behind a rock and lighting a small flare that glows against the white-out. Use harsh, cold lighting, blowing snow, handheld intensity and an isolated wide shot that shows the scale of the mountain. ${ONE_SCENE}`,
  },
  {
    slug: "space-adventure",
    title: "Short Space Adventure",
    description: "A pilot's daring manoeuvre through an asteroid field.",
    tags: ["space", "adventure", "spaceship", "sci-fi", "asteroids"],
    prompt: `Create a space-adventure film scene of a small starship weaving through a glittering asteroid field above a ringed planet, the pilot's focused face lit by cockpit displays as they pull off a daring manoeuvre into open space. Use realistic spacecraft design, dramatic rim light from a distant star, fast but readable camera moves and a majestic final wide shot. ${ONE_SCENE}`,
  },
  {
    slug: "african-folktale",
    title: "Short African Folktale Movie",
    description: "A richly told folktale moment in a traditional village.",
    featured: true,
    tags: ["african", "folktale", "village", "culture", "story", "african movie"],
    prompt:
      "Create a visually rich cinematic African folktale set in a traditional village surrounded by lush natural scenery. Introduce memorable characters wearing culturally appropriate clothing and place them in an engaging story involving a mysterious event, a difficult choice, and a meaningful resolution. Use atmospheric lighting, expressive performances, detailed scenery, and cinematic camera movements. Preserve character consistency and the visual identity of the setting throughout the sequence. Treat the culture and environment respectfully, with authentic details appropriate to the selected location and period.",
  },
  {
    slug: "african-urban-drama",
    title: "Short African Urban Drama",
    description: "Ambition and pressure in a vibrant modern African city.",
    tags: ["african", "urban", "city", "drama", "lagos", "nairobi", "african movie"],
    prompt: `Create an urban drama scene set in a vibrant modern African city such as Lagos, Nairobi or Accra at dusk: a young entrepreneur stands on a busy overpass above traffic and street vendors, phone in hand, receiving news that could change everything, then breaks into a determined smile. Use authentic street life, warm sodium and neon light, contemporary fashion and respectful, true-to-life detail. ${ONE_SCENE}`,
  },
  {
    slug: "mythological",
    title: "Short Mythological Movie",
    description: "Gods, legends and ancient powers awaken.",
    tags: ["mythology", "myth", "legend", "gods", "epic"],
    prompt: `Create a mythological film scene of an ancient deity rising from a sacred river at night, water streaming from their ornate attire as the stars brighten and villagers on the bank kneel in awe. Draw on the myth chosen by the user and portray its culture respectfully. Use luminous glowing effects, epic scale, slow upward camera movement and rich, mystical colour. ${ONE_SCENE}`,
  },
]);

/* ─────────────────────── C · animal kingdom & cartoons ─────────────────────── */

const animals = entries(M, ANIMALS, [
  {
    slug: "cartoon-kingdom",
    title: "Cartoon Animal Kingdom",
    description: "A magical 3D animated kingdom of animals in a tropical jungle.",
    featured: true,
    tags: ["cartoon", "animals", "animal kingdom", "3d", "jungle", "kids"],
    prompt:
      "Create a colorful, high-quality 3D animated video set in a magical animal kingdom hidden deep within a lush tropical jungle. Feature expressive animal characters with distinctive appearances, engaging facial expressions, and natural interactions. Show the animal kingdom's beautiful architecture, winding forest paths, waterfalls, and glowing plants. Use cinematic camera movements, rich environmental details, appealing character animation, and consistent character designs. Give the scene a sense of wonder, adventure, and family-friendly storytelling. Maintain visual continuity throughout the clip.",
  },
  {
    slug: "lion-kings-adventure",
    title: "The Lion King's Adventure",
    description: "A young lion prince surveys his savannah kingdom at sunrise.",
    tags: ["lion", "king", "savannah", "cartoon", "animal kingdom"],
    prompt: `Create a 3D animated scene of an original young lion prince climbing to the top of a great rock at sunrise and looking out over a golden savannah kingdom, where zebras, giraffes and birds stir below. Design an original character and world rather than any existing film's. Use a sweeping orbit around the rock, warm sunlight on the fur and a proud, hopeful mood. ${ANIMATED}`,
  },
  {
    slug: "talking-animals",
    title: "Talking Animals in a Jungle",
    description: "A charming, funny moment in a jungle village of talking animals.",
    tags: ["talking animals", "jungle", "cartoon", "comedy", "kids"],
    prompt:
      "Create a charming animated scene featuring a group of expressive talking animals living in a peaceful jungle village. Give each animal a distinct personality, recognizable appearance, and natural body language. Show the characters interacting with one another during an amusing situation, with expressive reactions and playful physical comedy. Use polished 3D animation, appealing lighting, detailed scenery, and consistent character designs. Keep the tone entertaining, warm, and suitable for a family audience.",
  },
  {
    slug: "baby-animals",
    title: "Baby Animals' Adventure",
    description: "Curious baby animals explore a meadow for the first time.",
    tags: ["baby animals", "cute", "cartoon", "kids", "meadow"],
    prompt: `Create a 3D animated scene of a curious baby elephant, a fluffy duckling and a little fox cub exploring a flower meadow together for the first time, chasing butterflies and tumbling over a small hill. Use soft pastel colours, gentle sunlight, playful bouncy movement and close-ups of their wide-eyed reactions. ${ANIMATED}`,
  },
  {
    slug: "animal-superheroes",
    title: "Animal Superheroes",
    description: "A team of animal heroes springs into action.",
    tags: ["animal superheroes", "heroes", "cartoon", "action", "kids"],
    prompt: `Create a 3D animated scene of a team of animal superheroes — a fast cheetah, a strong rhino and a clever owl in small capes and masks — leaping from their treehouse headquarters to rescue a kitten stuck on a windmill. Use dynamic heroic poses, bright saturated colours, energetic camera moves and a triumphant final group shot. ${ANIMATED}`,
  },
  {
    slug: "funny-monkey",
    title: "A Funny Monkey Adventure",
    description: "A mischievous monkey's banana heist goes wrong.",
    tags: ["monkey", "funny", "comedy", "cartoon", "jungle"],
    prompt: `Create a 3D animated comedy scene of a mischievous little monkey sneaking across vines to steal a giant bunch of bananas from a sleeping gorilla, only for one banana to drop and wake him at the worst moment. Use exaggerated expressive animation, clear comic timing, lush jungle scenery and a big reaction shot to finish. ${ANIMATED}`,
  },
  {
    slug: "clever-fox",
    title: "The Clever Fox",
    description: "A cunning fox outsmarts the farmyard.",
    tags: ["fox", "clever", "fable", "cartoon", "farm"],
    prompt: `Create a 3D animated fable scene of a clever fox in a tiny waistcoat tiptoeing through a moonlit farmyard, using a series of quick-witted tricks to slip past a sleepy guard dog and a suspicious goose. Use moonlit blues with warm lantern accents, sly expressive acting and playful staging. ${ANIMATED}`,
  },
  {
    slug: "brave-lion",
    title: "A Brave Little Lion",
    description: "A small lion cub finds its courage.",
    tags: ["lion", "brave", "cub", "cartoon", "kids"],
    prompt: `Create a 3D animated scene of a small, nervous lion cub standing at the edge of a stream while bigger animals watch, taking a deep breath and leaping across the stones to the other side, then letting out a tiny, proud roar. Use warm afternoon light, an encouraging tone, gentle slow motion on the leap and a heart-warming ending. ${ANIMATED}`,
  },
  {
    slug: "elephant-adventure",
    title: "An Epic Elephant Adventure",
    description: "A herd's great journey across the savannah.",
    tags: ["elephant", "epic", "journey", "savannah", "animals"],
    prompt: `Create an epic animated scene of a family of elephants led by a wise grandmother crossing a vast savannah towards distant mountains as a storm gathers, the youngest calf holding its mother's tail. Use grand sweeping wide shots, dramatic skies, rich golden light breaking through clouds and a sense of journey and family. ${ANIMATED}`,
  },
  {
    slug: "secret-kingdom",
    title: "Animals Building a Secret Kingdom",
    description: "Animals work together to build a hidden city.",
    tags: ["animals", "kingdom", "building", "teamwork", "cartoon"],
    prompt: `Create a 3D animated scene of animals working together to build a secret kingdom inside a giant hollow tree: beavers shaping wooden bridges, birds weaving roofs, squirrels carrying lanterns, as the finished city lights up at dusk. Use a slow revealing camera that rises through the levels, warm glowing lights and joyful teamwork. ${ANIMATED}`,
  },
  {
    slug: "magical-forest",
    title: "A Magical Forest Adventure",
    description: "Glowing creatures guide a traveller through an enchanted wood.",
    tags: ["magical forest", "fantasy", "glowing", "cartoon", "enchanted"],
    prompt: `Create an animated scene of a small rabbit following a trail of glowing fireflies through an enchanted forest of bioluminescent mushrooms and crystal flowers, arriving at a moonlit clearing where friendly woodland spirits dance. Use magical blue-violet light, floating particles, a gentle tracking camera and a sense of wonder. ${ANIMATED}`,
  },
  {
    slug: "underwater-kingdom",
    title: "Underwater Cartoon Kingdom",
    description: "A colourful kingdom beneath the waves.",
    tags: ["underwater", "ocean", "fish", "cartoon", "kingdom", "sea"],
    prompt: `Create a 3D animated scene of a colourful underwater kingdom where a cheerful young turtle swims through coral towers, past schools of shimmering fish and a palace made of shells, greeting friends along the way. Use caustic light rippling across everything, gentle floating motion, vivid reef colours and a slow descending camera. ${ANIMATED}`,
  },
  {
    slug: "dinosaurs",
    title: "Dinosaurs in a Lost World",
    description: "Dinosaurs roam a misty prehistoric valley.",
    tags: ["dinosaurs", "prehistoric", "lost world", "jurassic"],
    prompt: `Create a cinematic scene of a lost prehistoric valley at dawn: a herd of long-necked dinosaurs grazing by a misty lake while pterosaurs glide overhead, until the ground trembles and they all lift their heads towards the jungle. Use scientifically inspired, realistic anatomy and textures, volumetric morning mist, a sweeping aerial approach and a tense final beat. ${CRAFT}`,
  },
  {
    slug: "talking-pets",
    title: "Talking Pets at Home",
    description: "What the pets get up to when everyone leaves.",
    tags: ["pets", "dog", "cat", "talking", "home", "funny"],
    prompt: `Create a 3D animated comedy scene of a dog, a cat and a goldfish the moment their family leaves the house: the cat takes the sofa like a throne, the dog raids the snack cupboard and the goldfish directs everything from its bowl, until the front door handle turns. Use bright cosy interiors, snappy expressive animation and a perfectly timed freeze. ${ANIMATED}`,
  },
  {
    slug: "animals-city",
    title: "Animals Running a City",
    description: "A bustling city run entirely by animals.",
    tags: ["animals", "city", "cartoon", "urban", "funny"],
    prompt: `Create a 3D animated scene of a bustling city run by animals: a giraffe directing traffic, penguins in suits hurrying to work, a bear selling coffee from a cart and pigeons delivering parcels, all seen in one long flowing camera move along the main street. Use cheerful daylight, lots of small background gags and clear, readable staging. ${ANIMATED}`,
  },
  {
    slug: "panda",
    title: "A Cute Panda Adventure",
    description: "A playful panda's day in a bamboo forest.",
    tags: ["panda", "cute", "bamboo", "cartoon", "kids"],
    prompt: `Create a 3D animated scene of a playful baby panda in a misty bamboo forest trying again and again to reach a fresh bamboo shoot, rolling down a slope, getting up and finally sharing the shoot with a friendly red panda. Use soft green light, fluffy fur detail, gentle humour and adorable expressions. ${ANIMATED}`,
  },
  {
    slug: "dragon-kingdom",
    title: "A Fantasy Dragon Kingdom",
    description: "Dragons soar over a cliffside kingdom.",
    tags: ["dragon", "fantasy", "kingdom", "flying", "epic"],
    prompt: `Create a fantasy animated scene of a dragon kingdom carved into towering sea cliffs, where colourful dragons glide between stone towers at sunset and a young dragon makes its first wobbly flight from a ledge before catching the wind. Use epic scale, glowing sunset clouds, detailed scales and wings, and a soaring camera that follows the first flight. ${CRAFT}`,
  },
  {
    slug: "bird-adventure",
    title: "A Cartoon Bird Adventure",
    description: "A little bird's big journey across the sky.",
    tags: ["bird", "flying", "cartoon", "adventure", "sky"],
    prompt: `Create a 3D animated scene of a small, determined songbird flying across a patchwork countryside, racing a paper kite, dodging a windmill and soaring above the clouds into golden sunlight. Use a flowing aerial camera that stays with the bird, bright cheerful colours and a joyful sense of freedom. ${ANIMATED}`,
  },
  {
    slug: "wildlife-documentary",
    title: "A Wildlife Documentary",
    description: "Nature-documentary footage of animals in the wild.",
    tags: ["wildlife", "documentary", "nature", "realistic", "animals"],
    prompt: `Create a photorealistic wildlife-documentary scene of a leopard resting on a high acacia branch at dusk, its tail flicking as it watches gazelles graze on the plain below, before slowly rising to its feet. Use a long-lens, documentary look with natural light, shallow depth of field, steady tripod framing and accurate animal anatomy and behaviour, with no cartoon styling. ${CRAFT}`,
  },
  {
    slug: "realistic-safari",
    title: "Realistic Safari Adventure",
    description: "Lions and elephants on the savannah at golden hour, photorealistic.",
    featured: true,
    tags: ["safari", "lion", "elephant", "africa", "realistic", "wildlife", "savannah"],
    prompt:
      "Create a photorealistic wildlife documentary scene in the African savannah during golden hour. Show a small group of lions moving naturally through tall grass while distant elephants and other wildlife occupy the landscape. Capture realistic animal anatomy, authentic movement, natural environmental interactions, and believable lighting. Use professional wildlife cinematography, gentle camera tracking, atmospheric depth, and carefully composed wide and close-up shots. Preserve realistic animal proportions and avoid cartoon styling or unnatural movement.",
  },
  {
    slug: "animal-race",
    title: "Animals Competing in a Race",
    description: "A comic race between unlikely animal rivals.",
    tags: ["race", "animals", "competition", "funny", "cartoon"],
    prompt: `Create a 3D animated scene of an animal race through a forest course: a confident hare, a steady tortoise, a speedy ostrich and a clumsy hippo leaping logs and splashing through puddles, with a surprising photo finish. Use energetic tracking shots, slow motion at the finish line, cheering spectators and bright sporty colours. ${ANIMATED}`,
  },
  {
    slug: "lost-baby-animal",
    title: "A Lost Baby Animal Finds Its Family",
    description: "A heart-warming reunion after a long search.",
    tags: ["lost", "family", "reunion", "baby animal", "heartwarming"],
    prompt: `Create an animated scene of a lost baby zebra wandering alone through tall grass at dusk, hearing a familiar call and running over a hill to be reunited with its mother and herd, nuzzling close as the sun sets. Use warm emotional lighting, gentle camera work, expressive eyes and a tender, uplifting ending. ${ANIMATED}`,
  },
  {
    slug: "cat-and-dog",
    title: "A Funny Cat and Dog Adventure",
    description: "Rivals become partners in a backyard caper.",
    tags: ["cat", "dog", "funny", "pets", "comedy"],
    prompt: `Create a 3D animated comedy scene of a proud cat and an over-excited dog teaming up to retrieve a ball stuck on the garden shed roof, building a wobbly tower of flowerpots and a skateboard that collapses at the perfect moment. Use bright suburban daylight, clear slapstick timing and big expressive reactions. ${ANIMATED}`,
  },
  {
    slug: "animal-school",
    title: "A Magical Animal School",
    description: "Young animals learn spells at an enchanted school.",
    tags: ["school", "magic", "animals", "fantasy", "kids"],
    prompt: `Create a 3D animated scene in a magical school for young animals inside a castle: a little owl teacher waves a wand as a class of bunnies, kittens and fox cubs try their first floating spell, with books and teacups drifting into the air and one spell going comically wrong. Use warm candlelit interiors, sparkling magic effects and playful, wondrous energy. ${ANIMATED}`,
  },
]);

/* ─────────────────────── D · cinematic & visual effects ─────────────────────── */

const cinematic = entries(M, CINEMATIC, [
  {
    slug: "epic-intro",
    title: "Epic Cinematic Intro",
    description: "A grand opening shot for a film, channel or story.",
    featured: true,
    tags: ["intro", "epic", "opening", "cinematic", "title"],
    prompt: `Create an epic cinematic opening shot: the camera glides low over a dark ocean at dawn towards towering cliffs, rises steadily over the edge and reveals a vast valley glowing in the first light, with clean empty sky in the upper third for a title. Use a slow, confident crane movement, volumetric light, atmospheric haze and a rich orchestral-trailer mood. ${CRAFT}`,
  },
  {
    slug: "slow-motion",
    title: "Slow-Motion Action Shot",
    description: "A dramatic moment frozen in super slow motion.",
    tags: ["slow motion", "action", "dramatic", "high speed"],
    prompt: `Create a super slow-motion shot of an athlete diving into a swimming pool, capturing water droplets suspended in the air, the ripple of the surface and the burst of bubbles as they break through. Use crisp high-speed-camera detail, bright backlight that makes the water sparkle, and a smooth tracking camera. ${CRAFT}`,
  },
  {
    slug: "camera-reveal",
    title: "Dramatic Camera Reveal",
    description: "A slow move that reveals something astonishing.",
    tags: ["reveal", "camera", "dramatic", "cinematic"],
    prompt: `Create a dramatic camera reveal: start tight on a traveller's boots on a stone path, tilt up slowly past their back as they stop, then rise over their shoulder to reveal an immense ancient city spread across a canyon below. Use a single unbroken move, golden-hour light and haze that gives the reveal its scale. ${CRAFT}`,
  },
  {
    slug: "aerial-drone",
    title: "Aerial Drone-Style Landscape",
    description: "Smooth drone footage over stunning scenery.",
    tags: ["drone", "aerial", "landscape", "travel", "scenery"],
    prompt: `Create aerial drone-style footage gliding over a winding river through green highlands at sunrise, passing over a waterfall and slowly rising to reveal mist-filled valleys stretching to the horizon. Use a smooth, stable gimbal-like motion, natural colour, soft morning light and realistic terrain detail. ${CRAFT}`,
  },
  {
    slug: "explosion",
    title: "Epic Explosion Scene",
    description: "A blockbuster explosion with a hero walking away.",
    tags: ["explosion", "action", "vfx", "blockbuster"],
    prompt: `Create a blockbuster visual-effects shot of a lone figure walking calmly towards the camera across an abandoned industrial yard as a huge fireball erupts from a warehouse behind them, debris and sparks raining down in slow motion. Use realistic fire and smoke simulation, strong backlight silhouetting the figure and a steady low-angle camera. ${CRAFT}`,
  },
  {
    slug: "futuristic-city",
    title: "Futuristic City Reveal",
    description: "A sweeping flight into a city of the future.",
    tags: ["futuristic", "city", "sci-fi", "skyline", "neon"],
    prompt: `Create a sweeping reveal of a futuristic city at dusk: the camera flies between gleaming towers linked by sky bridges, past flying vehicles and vertical gardens, and pulls back to reveal the full glowing skyline beside the sea. Use cinematic scale, neon and warm window light, light atmospheric haze and believable architecture. ${CRAFT}`,
  },
  {
    slug: "magical-transformation",
    title: "Magical Transformation",
    description: "Something ordinary transforms with spellbinding effects.",
    tags: ["magic", "transformation", "vfx", "fantasy"],
    prompt: `Create a magical transformation shot: a simple wooden staff resting on a table begins to glow, golden particles spiral around it and it reshapes into an ornate crystal sceptre that lifts gently into the air. Use elegant particle effects, warm and cool contrasting light, a slow orbit around the object and a soft magical shimmer. ${CRAFT}`,
  },
  {
    slug: "time-lapse-city",
    title: "Time-Lapse City",
    description: "A city's day melting into night in fast motion.",
    tags: ["time-lapse", "city", "night", "traffic", "timelapse"],
    prompt: `Create a time-lapse of a city skyline from late afternoon into night: clouds racing across the sky, the sun setting, office windows flicking on, and traffic turning into ribbons of light on the streets below. Keep the camera locked off or moving in a very slow, steady slide, with smooth exposure changes and crisp detail. ${CRAFT}`,
  },
  {
    slug: "dreamlike",
    title: "Dreamlike Fantasy Scene",
    description: "A surreal, floating dreamscape.",
    tags: ["dream", "surreal", "fantasy", "ethereal"],
    prompt: `Create a dreamlike surreal scene of a person in flowing clothes walking across a calm lake that reflects a pastel sky, with floating islands, slow-moving whales in the clouds and petals drifting upwards. Use soft diffused light, a gentle floating camera, a muted pastel palette and an ethereal, calm mood. ${CRAFT}`,
  },
  {
    slug: "product-reveal",
    title: "Product Cinematic Reveal",
    description: "A premium reveal of a product from darkness.",
    tags: ["product", "reveal", "commercial", "luxury", "advert"],
    prompt: `Create a premium cinematic product reveal: in a dark studio, a thin line of light sweeps across a sleek product on a reflective surface, gradually revealing its form, materials and details before the full product is lit in a final hero shot. Use controlled studio lighting, slow motion, elegant reflections and a high-end commercial look. ${CRAFT}`,
  },
]);

/* ─────────────────────── D · social media & viral ─────────────────────── */

const social = entries(M, SOCIAL, [
  {
    slug: "comedy-skit",
    title: "Viral Comedy Skit",
    description: "A quick, relatable skit with a punchline.",
    featured: true,
    tags: ["comedy", "skit", "viral", "funny", "tiktok"],
    prompt: `Create a vertical comedy skit: a person confidently says they will only buy one thing at the supermarket, then the camera cuts to them at the checkout with an overflowing trolley and a guilty smile at the camera. Use bright natural lighting, clear expressive acting, quick comedic timing and phone-friendly framing with the subject centred. ${CRAFT}`,
  },
  {
    slug: "tiktok-style",
    title: "Cinematic TikTok-Style Video",
    description: "A stylish vertical clip with smooth transitions.",
    tags: ["tiktok", "vertical", "reel", "cinematic", "trend"],
    prompt: `Create a stylish vertical video of a person walking through a colourful city street at golden hour, the camera following smoothly from behind, then whipping around to their face as they turn and smile, with a seamless motion-matched transition into a night-time version of the same street. Use trendy colour grading, dynamic but smooth movement and the subject centred for a 9:16 frame. ${CRAFT}`,
  },
  {
    slug: "reel-intro",
    title: "Instagram Reel Intro",
    description: "A punchy opening to hook viewers in two seconds.",
    tags: ["instagram", "reel", "intro", "hook", "opening"],
    prompt: `Create a punchy vertical reel intro: a creator steps into frame against a clean colourful wall, snaps their fingers and the background bursts into floating confetti and shapes that settle into an empty space for a title. Use bold, bright colours, crisp lighting, fast but clean motion and a hook within the first two seconds. ${CRAFT}`,
  },
  {
    slug: "everyday-situation",
    title: "Funny Everyday Situation",
    description: "The small daily disaster everyone recognises.",
    tags: ["funny", "everyday", "relatable", "comedy"],
    prompt: `Create a funny everyday moment: someone carefully balances a full cup of coffee, a laptop and a sandwich while opening a door with their elbow, and the door swings back at exactly the wrong moment, frozen just before the spill as they stare at the camera. Use natural home lighting, clear staging and well-timed slow motion. ${CRAFT}`,
  },
  {
    slug: "plot-twist",
    title: "Unexpected Plot Twist",
    description: "A scene that turns completely in the last second.",
    tags: ["plot twist", "twist", "surprise", "viral"],
    prompt: `Create a short scene with a twist: a tense figure creeps down a dark corridor towards a door with light flickering underneath, flings it open, and reveals a surprise birthday party with friends jumping out and confetti in the air. Use suspenseful lighting that flips into bright warm party light, a slow push-in and a fast reveal. ${CRAFT}`,
  },
  {
    slug: "satisfying",
    title: "Satisfying Visual Sequence",
    description: "Hypnotic, perfectly smooth satisfying visuals.",
    tags: ["satisfying", "asmr", "loop", "hypnotic"],
    prompt: `Create an oddly satisfying visual sequence: glossy coloured spheres rolling down a smooth marble track, dropping perfectly into matching slots, and liquid paint swirling into flawless patterns in a glass bowl. Use clean studio lighting, macro close-ups, smooth continuous motion and a seamless, loop-friendly ending. ${CRAFT}`,
  },
  {
    slug: "before-after",
    title: "Before-and-After Transformation",
    description: "A dramatic reveal of a transformation.",
    tags: ["before and after", "transformation", "makeover", "reveal"],
    prompt: `Create a before-and-after transformation: a dull, cluttered bedroom transforms in a single smooth sweep of light into a bright, stylish, perfectly arranged room, with furniture and décor appearing in place as the light passes. Keep the camera position fixed so the change is clear, with natural lighting and a satisfying final hold. ${CRAFT}`,
  },
  {
    slug: "inspirational",
    title: "Inspirational Short Video",
    description: "An uplifting moment of hope and progress.",
    tags: ["inspirational", "uplifting", "hope", "motivation"],
    prompt: `Create an inspirational scene of a young woman planting a small tree on a hilltop at sunrise, the camera rising to reveal the same hill covered in a thriving forest planted by her community. Use warm hopeful light, a slow crane movement, rich greens and a quietly emotional, uplifting tone. ${CRAFT}`,
  },
  {
    slug: "motivational",
    title: "Motivational Cinematic Scene",
    description: "Grit, training and the moment it pays off.",
    tags: ["motivation", "training", "sport", "determination", "gym"],
    prompt: `Create a motivational cinematic scene of a runner training alone before dawn, breath visible in the cold air, pushing up a steep flight of stadium steps and reaching the top just as the sun breaks over the horizon. Use dramatic contrast lighting, slow motion at the peak, a tracking camera and an intense, determined mood. ${CRAFT}`,
  },
  {
    slug: "relatable-comedy",
    title: "Relatable Everyday Comedy",
    description: "The 'just five more minutes' morning, in one shot.",
    tags: ["relatable", "comedy", "morning", "funny", "everyday"],
    prompt: `Create a relatable comedy moment: an alarm rings, a person in bed lifts one hand to snooze it and the room instantly brightens to full midday sun as they sit up in panic, staring at the clock. Use a fixed top-down camera, cosy bedroom lighting that jumps to bright daylight, and clear, exaggerated expressions. ${CRAFT}`,
  },
]);

/* ─────────────────────── D · fashion & lifestyle ─────────────────────── */

const fashion = entries(M, FASHION, [
  {
    slug: "luxury-commercial",
    title: "Luxury Fashion Commercial",
    description: "A high-end fashion film with elegant movement.",
    featured: true,
    tags: ["fashion", "luxury", "commercial", "model", "advert"],
    prompt: `Create a high-end fashion commercial: a model in a flowing silk gown walks through a minimalist marble hall as sheer curtains billow in the wind, turning towards the camera in a slow, confident pose. Use soft directional light, slow motion on the fabric, an elegant tracking camera and a refined, editorial colour grade. ${CRAFT}`,
  },
  {
    slug: "cinematic-portrait",
    title: "Cinematic Portrait",
    description: "A moving portrait with film-quality light.",
    tags: ["portrait", "cinematic", "face", "close-up"],
    prompt: `Create a cinematic moving portrait: a person stands by a window at golden hour, light falling across half their face, as they slowly turn their head towards the camera and their expression softens into a calm smile. Use a shallow depth of field, a very slow push-in, natural skin texture and rich, warm tones. ${CRAFT}`,
  },
  {
    slug: "streetwear",
    title: "Streetwear Fashion Video",
    description: "Urban style, bold attitude and city energy.",
    tags: ["streetwear", "fashion", "urban", "sneakers", "style"],
    prompt: `Create a streetwear fashion video: a stylish young person in a layered outfit, bold sneakers and a bucket hat walks under a graffiti-covered bridge, pausing to pose against a wall as the camera circles them. Use punchy contrast, a gritty urban colour grade, energetic camera moves and crisp fabric detail. ${CRAFT}`,
  },
  {
    slug: "luxury-lifestyle",
    title: "Luxury Lifestyle Scene",
    description: "Sunset, a villa and effortless elegance.",
    tags: ["luxury", "lifestyle", "villa", "travel", "elegant"],
    prompt: `Create a luxury lifestyle scene at a cliffside villa at sunset: a person in elegant resort wear walks along an infinity pool overlooking the sea, picks up a glass from a table and gazes at the horizon. Use warm golden light, smooth gimbal movement, glistening water and a calm, aspirational mood. ${CRAFT}`,
  },
  {
    slug: "beauty-campaign",
    title: "Beauty Campaign",
    description: "A radiant close-up for a skincare or beauty brand.",
    tags: ["beauty", "skincare", "makeup", "campaign", "advert"],
    prompt: `Create a beauty campaign close-up: a model with radiant, natural skin turns gently into soft light as droplets of water glisten on her cheek, the camera moving in a slow arc around her face. Use clean high-key lighting, true-to-life skin texture without plastic smoothing, a soft pastel background and a fresh, premium look. ${CRAFT}`,
  },
  {
    slug: "runway",
    title: "Fashion Runway",
    description: "A model owns the catwalk at a fashion show.",
    tags: ["runway", "catwalk", "fashion show", "model"],
    prompt: `Create a fashion runway scene: a model in a structured couture outfit walks the length of a dramatic catwalk lined with spotlights and a seated audience, stopping at the end for a confident pose as camera flashes fire. Use a frontal tracking shot, high-contrast stage lighting and crisp detail on fabric and tailoring. ${CRAFT}`,
  },
  {
    slug: "futuristic-editorial",
    title: "Futuristic Fashion Editorial",
    description: "Avant-garde style in a sci-fi setting.",
    tags: ["futuristic", "fashion", "editorial", "avant-garde", "sci-fi"],
    prompt: `Create a futuristic fashion editorial: a model in a sculptural metallic outfit stands in a white geometric space as holographic light patterns ripple across the walls and the outfit, turning slowly as the camera orbits. Use cool iridescent lighting, clean minimal composition and a striking avant-garde mood. ${CRAFT}`,
  },
  {
    slug: "watch-ad",
    title: "Luxury Watch Advertisement",
    description: "Precision, craftsmanship and a perfect close-up.",
    tags: ["watch", "luxury", "advertisement", "product", "jewellery"],
    prompt: `Create a luxury watch advertisement: extreme macro shots glide across a polished watch face, the second hand ticking in slow motion and light sweeping over the brushed metal, ending on the watch on a wrist resting on a dark leather surface. Use precise studio lighting, rich reflections and a refined, premium mood. Leave any brand name exactly as the user specifies. ${CRAFT}`,
  },
  {
    slug: "perfume",
    title: "Perfume Commercial",
    description: "A sensual, dreamy fragrance film.",
    tags: ["perfume", "fragrance", "commercial", "luxury", "advert"],
    prompt: `Create a perfume commercial: a crystal bottle rests on still water as petals fall in slow motion around it, then a sheer veil of mist sweeps past and reveals a model in flowing fabric turning gracefully in a garden of soft light. Use dreamy diffused lighting, elegant slow motion, a soft warm palette and an intimate, luxurious mood. ${CRAFT}`,
  },
  {
    slug: "premium-showcase",
    title: "Premium Product Showcase",
    description: "A clean, elegant turntable showcase.",
    tags: ["product", "showcase", "premium", "turntable", "e-commerce"],
    prompt: `Create a premium product showcase: the product rotates slowly on a minimal pedestal against a soft gradient background while light glides across its surfaces, highlighting materials, textures and fine details, before settling into a clean front-facing hero shot. Use controlled studio lighting, accurate colours and gentle reflections. ${CRAFT}`,
  },
]);

/* ─────────────────────── D · nature & travel ─────────────────────── */

const nature = entries(M, NATURE, [
  {
    slug: "tropical-paradise",
    title: "Tropical Paradise",
    description: "Turquoise water, palms and white sand.",
    tags: ["tropical", "beach", "island", "travel", "paradise"],
    prompt: `Create a tropical paradise scene: the camera glides low over turquoise water towards a white-sand beach lined with swaying palm trees, small waves rolling gently onto the shore under a bright blue sky. Use vivid natural colour, sparkling sunlight on the water, a smooth forward drone movement and a relaxing mood. ${CRAFT}`,
  },
  {
    slug: "wildlife-safari",
    title: "African Wildlife Safari",
    description: "A safari jeep among elephants and giraffes.",
    tags: ["safari", "africa", "wildlife", "elephants", "giraffes", "travel"],
    prompt: `Create an African wildlife safari scene: an open safari vehicle pauses on a dusty track as a herd of elephants crosses ahead and giraffes browse acacia trees in the background, under a warm late-afternoon sky. Use photorealistic animals with natural behaviour, golden light, documentary-style framing and a sense of respectful wonder. ${CRAFT}`,
  },
  {
    slug: "mountain-adventure",
    title: "Mountain Adventure",
    description: "Hikers above the clouds on a dramatic ridge.",
    tags: ["mountain", "hiking", "adventure", "peaks", "travel"],
    prompt: `Create a mountain adventure scene: two hikers walk along a narrow ridge above a sea of clouds at sunrise, snowy peaks glowing pink in the distance, the camera sweeping past them to reveal the drop on either side. Use crisp alpine light, epic scale, a smooth aerial orbit and realistic terrain. ${CRAFT}`,
  },
  {
    slug: "ocean-underwater",
    title: "Ocean and Underwater World",
    description: "A dive into a vibrant coral reef.",
    tags: ["ocean", "underwater", "coral", "reef", "sea", "diving"],
    prompt: `Create an underwater scene: the camera dives beneath the surface into a vibrant coral reef where a sea turtle glides past, schools of fish part around the lens and sun rays shimmer down through the water. Use realistic marine life, natural blue and teal tones, light caustics and slow, floating camera movement. ${CRAFT}`,
  },
  {
    slug: "waterfall",
    title: "Waterfall Cinematic Scene",
    description: "A towering waterfall in a misty rainforest.",
    tags: ["waterfall", "rainforest", "nature", "mist"],
    prompt: `Create a cinematic waterfall scene: a towering waterfall plunges into a jungle pool, mist rising and catching a rainbow in the sunlight, the camera slowly rising from the pool's surface to the top of the falls. Use lush greens, realistic water simulation, soft volumetric light and a peaceful, majestic mood. ${CRAFT}`,
  },
  {
    slug: "eco-city",
    title: "Futuristic Eco-City",
    description: "A green city of the future in harmony with nature.",
    tags: ["eco", "green", "future", "city", "sustainable"],
    prompt: `Create a futuristic eco-city: towers covered in hanging gardens and solar glass, clean trams gliding along tree-lined streets, rivers running through parks and people cycling below, all seen in one slow, sweeping aerial move. Use bright natural daylight, lush greenery, believable architecture and an optimistic tone. ${CRAFT}`,
  },
  {
    slug: "sunset",
    title: "Beautiful Sunset Landscape",
    description: "A breathtaking sunset over open land.",
    tags: ["sunset", "landscape", "sky", "golden hour"],
    prompt: `Create a breathtaking sunset landscape: the sun sinks behind rolling hills and a lone baobab tree, the sky shifting from gold to deep orange and violet, birds crossing in silhouette. Use a slow lateral slide of the camera, rich natural colour, glowing clouds and a calm, reflective mood. ${CRAFT}`,
  },
  {
    slug: "magical-forest",
    title: "Magical Forest",
    description: "An enchanted forest glowing at twilight.",
    tags: ["forest", "magical", "fantasy", "glowing", "enchanted"],
    prompt: `Create a magical forest at twilight: ancient moss-covered trees, glowing mushrooms and drifting fireflies light a winding path as soft fog rolls between the trunks, the camera gliding slowly forward along the path. Use cool blue and warm amber light, floating particles and a gentle, enchanting mood. ${CRAFT}`,
  },
  {
    slug: "storm-ocean",
    title: "Storm Over the Ocean",
    description: "Lightning, towering waves and raw power.",
    tags: ["storm", "ocean", "lightning", "waves", "dramatic"],
    prompt: `Create a dramatic storm over the ocean: towering dark waves crash against a lone lighthouse as lightning splits the sky, rain sweeping across the frame and the lighthouse beam cutting through the darkness. Use realistic water and weather simulation, high-contrast moody lighting and a steady wide shot that conveys scale. ${CRAFT}`,
  },
  {
    slug: "space",
    title: "Space Exploration",
    description: "Earth, stars and a spacecraft in orbit.",
    tags: ["space", "earth", "orbit", "astronaut", "stars"],
    prompt: `Create a space-exploration scene: a spacecraft glides slowly in orbit above Earth as the sun rises over the planet's curved horizon, light spilling across clouds and oceans, with an astronaut floating at an open hatch. Use realistic scale and lighting, a deep star field and slow, majestic camera movement. ${CRAFT}`,
  },
]);

/* ─────────────────────── D · music & performance ─────────────────────── */

const music = entries(M, MUSIC, [
  {
    slug: "music-video",
    title: "Music Video Scene",
    description: "A stylish performance shot for a music video.",
    tags: ["music video", "singer", "performance", "song"],
    prompt: `Create a music-video scene: a singer performs passionately in an empty warehouse lit by coloured light beams cutting through haze, the camera circling them slowly as the lights pulse in rhythm. Use moody saturated colour, smooth movement, expressive performance and strong silhouettes. ${CRAFT}`,
  },
  {
    slug: "dance-performance",
    title: "Cinematic Dance Performance",
    description: "An elegant contemporary dance under a spotlight.",
    tags: ["dance", "contemporary", "performance", "ballet"],
    prompt: `Create a cinematic dance performance: a contemporary dancer moves gracefully across a dark stage under a single spotlight, flowing fabric trailing each turn and leap, the camera following in one smooth continuous take. Use clean anatomy and believable motion, dramatic contrast lighting and subtle slow motion at the peaks. ${CRAFT}`,
  },
  {
    slug: "hip-hop",
    title: "Hip-Hop Music Video",
    description: "Street energy, crew and attitude.",
    tags: ["hip-hop", "rap", "music video", "street", "urban"],
    prompt: `Create a hip-hop music-video scene: an artist performs to the camera on a city rooftop at night with their crew behind them, city lights below, the camera pushing in with low angles and quick, smooth moves on the beat. Use bold contrast, neon accents, confident attitude and crisp detail on outfits and jewellery. ${CRAFT}`,
  },
  {
    slug: "afrobeats",
    title: "Afrobeats Music Video",
    description: "Vibrant colour, dance and celebration.",
    featured: true,
    tags: ["afrobeats", "african", "music video", "dance", "party"],
    prompt: `Create an Afrobeats music-video scene: a joyful group of dancers in vibrant, stylish outfits performs synchronised moves on a colourful street at golden hour, the lead artist singing to the camera as neighbours clap and join in. Use warm, saturated colour, energetic but smooth camera work, authentic contemporary African style and a celebratory mood. ${CRAFT}`,
  },
  {
    slug: "concert",
    title: "Concert Stage Performance",
    description: "A headline show with lights and a roaring crowd.",
    tags: ["concert", "stage", "live", "crowd", "festival"],
    prompt: `Create a concert stage performance: an artist stands centre stage in front of a sea of raised hands and phone lights as beams of light sweep the arena and confetti cannons fire. Use a sweeping crane shot from behind the crowd up to the stage, realistic stage lighting, atmospheric haze and electric energy. ${CRAFT}`,
  },
  {
    slug: "fantasy-musical",
    title: "Fantasy Musical Performance",
    description: "A song that makes the world around it come alive.",
    tags: ["musical", "fantasy", "song", "magic"],
    prompt: `Create a fantasy musical moment: a young singer in a village square begins to sing and flowers bloom along the walls, lanterns rise into the air and passers-by begin to dance around them. Use warm magical light, flowing choreography, a sweeping circular camera and a joyful, theatrical tone. ${CRAFT}`,
  },
  {
    slug: "solo-dance",
    title: "Dramatic Solo Dance",
    description: "Raw emotion expressed through movement in the rain.",
    tags: ["dance", "solo", "emotional", "rain"],
    prompt: `Create a dramatic solo dance: a dancer performs powerful, emotional movements in the rain on an empty street at night, water splashing with every step, lit by a single streetlight. Use slow motion at key moments, realistic rain and reflections, deep shadows and a raw, expressive mood. ${CRAFT}`,
  },
  {
    slug: "street-dance",
    title: "Street Dance Sequence",
    description: "A crew battle with sharp, crowd-pleasing moves.",
    tags: ["street dance", "breakdance", "crew", "battle"],
    prompt: `Create a street-dance sequence: two crews face off in a circle of cheering onlookers in a basketball court at dusk, a dancer stepping in with sharp popping moves and finishing with a freeze that sends the crowd wild. Use clear readable choreography, energetic camera moves at ground level, urban colour and fast but coherent motion. ${CRAFT}`,
  },
]);

/* ─────────────────────── D · business & advertising ─────────────────────── */

const business = entries(M, BUSINESS, [
  {
    slug: "product-ad",
    title: "Professional Product Advertisement",
    description: "A polished ad that shows a product at its best.",
    featured: true,
    tags: ["product", "advertisement", "advert", "commercial", "ad"],
    prompt: `Create a professional product advertisement: the product sits on a clean surface in a bright modern setting, the camera moving smoothly around it to highlight its design, then cutting to a person using it with satisfaction. Use crisp commercial lighting, accurate colours, gentle depth of field and a confident, trustworthy tone. Show any brand name or text exactly as the user specifies, and add none of its own. ${CRAFT}`,
  },
  {
    slug: "brand-launch",
    title: "Brand Launch Video",
    description: "A bold reveal for a new brand.",
    tags: ["brand", "launch", "logo", "reveal", "business"],
    prompt: `Create a brand launch video: abstract shapes in the brand's colours flow and assemble in a clean studio space, light bursts through them and they settle into an elegant empty centre where the brand's logo can be placed. Use smooth premium motion, a modern minimal look and a confident, exciting energy. Do not invent a logo or text of its own. ${CRAFT}`,
  },
  {
    slug: "luxury-product",
    title: "Luxury Product Commercial",
    description: "A dark, elegant commercial for a premium item.",
    tags: ["luxury", "product", "commercial", "premium", "advert"],
    prompt: `Create a luxury product commercial: the product is revealed on a black glass surface as gold light traces its edges, slow-motion particles drift through the beams and the camera glides in for a final elegant close-up. Use dark, rich tones, precise reflections and a refined, exclusive mood. ${CRAFT}`,
  },
  {
    slug: "fashion-brand",
    title: "Fashion Brand Advertisement",
    description: "A stylish ad for a clothing label.",
    tags: ["fashion", "brand", "clothing", "advertisement", "advert"],
    prompt: `Create a fashion brand advertisement: models wearing the label's collection walk confidently through a sunlit city plaza, the camera tracking alongside and catching the movement of the fabric, ending with a group shot. Use a fresh contemporary colour grade, smooth movement and a stylish, aspirational mood. ${CRAFT}`,
  },
  {
    slug: "restaurant",
    title: "Restaurant Commercial",
    description: "Mouth-watering food and a warm atmosphere.",
    tags: ["restaurant", "food", "commercial", "chef", "advert"],
    prompt: `Create a restaurant commercial: a chef plates a signature dish with care as flames rise in the open kitchen, steam curls up from the plate, and the dish is carried to a smiling table in a warmly lit dining room. Use appetising macro close-ups, warm ambient lighting, gentle slow motion and an inviting mood. ${CRAFT}`,
  },
  {
    slug: "mobile-app",
    title: "Mobile App Promotional Video",
    description: "Show an app in action in real life.",
    tags: ["app", "mobile", "smartphone", "promo", "tech"],
    prompt: `Create a mobile-app promotional video: a person taps their smartphone in a bright café, and clean floating interface panels rise from the screen and orbit around them, showing the app making their day easier, before settling back into the phone. Use modern, bright lighting, smooth motion graphics, accurate hands and phone, and no readable text unless the user provides it. ${CRAFT}`,
  },
  {
    slug: "real-estate",
    title: "Real Estate Showcase",
    description: "A smooth walkthrough of a beautiful property.",
    tags: ["real estate", "property", "house", "interior", "home"],
    prompt: `Create a real-estate showcase: a smooth walkthrough enters a modern home through the front door, glides through a bright open-plan living room and kitchen, and ends on a terrace with a view, as afternoon light pours through large windows. Use wide-angle stabilised movement, true-to-life colours and a welcoming, spacious feel. ${CRAFT}`,
  },
  {
    slug: "business-intro",
    title: "Cinematic Business Introduction",
    description: "Introduce a company with a professional, human touch.",
    tags: ["business", "company", "corporate", "introduction", "team"],
    prompt: `Create a cinematic business introduction: the camera glides through a modern office where a diverse team collaborates around screens and whiteboards, a leader smiles towards the camera, and the shot rises to the city view outside. Use natural light, a warm professional colour grade, smooth gimbal movement and an authentic, trustworthy mood. ${CRAFT}`,
  },
  {
    slug: "ecommerce",
    title: "E-commerce Product Showcase",
    description: "A clean, clear product video for a shop listing.",
    tags: ["e-commerce", "ecommerce", "product", "shop", "online store"],
    prompt: `Create an e-commerce product video: the product on a pure white background rotates a full turn, then the camera moves in on its key details and features one by one, and finishes on a clean front view. Use bright even lighting, accurate colours, sharp focus and a simple, distraction-free look suitable for an online store. ${CRAFT}`,
  },
  {
    slug: "social-ad",
    title: "Social Media Advertising Creative",
    description: "A thumb-stopping vertical ad for social feeds.",
    tags: ["social media", "ad", "advert", "vertical", "marketing"],
    prompt: `Create a thumb-stopping vertical social-media ad: in the first second the product drops into frame with a satisfying bounce against a bold colourful background, then a person picks it up and uses it with a delighted reaction, ending on a clean product shot with space for a message. Use bright punchy colour, fast but smooth motion and a 9:16-friendly composition. ${CRAFT}`,
  },
]);

export const TEXT_TO_VIDEO_PROMPTS: PromptSuggestion[] = [
  ...characterReplacement,
  ...shortMovies,
  ...animals,
  ...cinematic,
  ...social,
  ...fashion,
  ...nature,
  ...music,
  ...business,
];

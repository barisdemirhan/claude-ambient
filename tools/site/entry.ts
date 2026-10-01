// What the repo's page needs of the mod, bundled for a browser: the scenes
// as the band runs them, and the canvas they paint on.
import { KINDS, KIND_COLORS, SCENES } from '../../hooks/catalog'
import { canvasOf, rowsOf } from '../../hooks/kit'
import { aquarium } from '../../hooks/scenes/aquarium'
import { bonsai } from '../../hooks/scenes/bonsai'
import { city } from '../../hooks/scenes/city'
import { fire } from '../../hooks/scenes/fire'
import { life } from '../../hooks/scenes/life'
import { lofi } from '../../hooks/scenes/lofi'
import { matrix } from '../../hooks/scenes/matrix'
import { pulse } from '../../hooks/scenes/pulse'
import { stars } from '../../hooks/scenes/stars'
import { train } from '../../hooks/scenes/train'
import { weather } from '../../hooks/scenes/weather'

Object.assign(globalThis, {
  AmbientScenes: {
    catalog: SCENES,
    kinds: KINDS,
    kindColors: KIND_COLORS,
    scenes: { aquarium, bonsai, city, stars, weather, train, life, pulse, fire, matrix, lofi },
    canvasOf,
    rowsOf,
  },
})

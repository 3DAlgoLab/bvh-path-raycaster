import { Box3, BufferAttribute } from 'three'
import { MeshBVH } from 'three-mesh-bvh'

function decodeBase64(base64, enableUnicode) {
  var binaryString = atob(base64)
  if (enableUnicode) {
    var binaryView = new Uint8Array(binaryString.length)
    for (var i = 0, n = binaryString.length; i < n; ++i) {
      binaryView[i] = binaryString.charCodeAt(i)
    }
    return String.fromCharCode.apply(null, new Uint16Array(binaryView.buffer))
  }
  return binaryString
}

function createURL(base64, sourcemapArg, enableUnicodeArg) {
  var sourcemap = sourcemapArg === undefined ? null : sourcemapArg
  var enableUnicode = enableUnicodeArg === undefined ? false : enableUnicodeArg
  var source = decodeBase64(base64, enableUnicode)
  var start = source.indexOf('\n', 10) + 1
  var body = source.substring(start) + (sourcemap ? '//# sourceMappingURL=' + sourcemap : '')
  var blob = new Blob([body], { type: 'application/javascript' })
  return URL.createObjectURL(blob)
}

function createBase64WorkerFactory(base64, sourcemapArg, enableUnicodeArg) {
  var url
  return function WorkerFactory(options) {
    url = url || createURL(base64, sourcemapArg, enableUnicodeArg)
    return new Worker(url, options)
  }
}

var WorkerFactory = createBase64WorkerFactory(
  null,
  false
)
/* eslint-enable */

export class GenerateMeshBVHWorker {
  constructor() {
    this.running = false
    this.worker = new WorkerFactory()
  }

  generate(geometry, options = {}) {
    if (this.running) {
      throw new Error('GenerateMeshBVHWorker: Already running job.')
    }

    const { worker } = this
    this.running = true

    return new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        this.running = false
        const { data } = e

        if (data.error) {
          reject(new Error(data.error))
          worker.onmessage = null
        } else if (data.serialized) {
          const { serialized, position } = data
          const bvh = MeshBVH.deserialize(serialized, geometry, { setIndex: false })
          const boundsOptions = Object.assign(
            {
              setBoundingBox: true
            },
            options
          )

          // we need to replace the arrays because they're neutered entirely by the
          // webworker transfer.
          geometry.attributes.position.array = position
          if (geometry.index) {
            geometry.index.array = serialized.index
          } else {
            const newIndex = new BufferAttribute(serialized.index, 1, false)
            geometry.setIndex(newIndex)
          }

          if (boundsOptions.setBoundingBox) {
            geometry.boundingBox = bvh.getBoundingBox(new Box3())
          }

          resolve(bvh)
          worker.onmessage = null
        } else if (options.onProgress) {
          options.onProgress(data.progress)
        }
      }

      const index = geometry.index ? geometry.index.array : null
      const position = geometry.attributes.position.array

      if (position.isInterleavedBufferAttribute || (index && index.isInterleavedBufferAttribute)) {
        throw new Error('GenerateMeshBVHWorker: InterleavedBufferAttribute are not supported for the geometry attributes.')
      }

      const transferrables = [position]
      if (index) {
        transferrables.push(index)
      }

      worker.postMessage(
        {
          index,
          position,
          options: {
            ...options,
            onProgress: null,
            includedProgressCallback: Boolean(options.onProgress)
          }
        },
        transferrables.map((arr) => arr.buffer)
      )
    })
  }

  terminate() {
    this.worker.terminate()
  }
}
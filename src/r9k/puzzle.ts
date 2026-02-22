import sharp from 'sharp';

const neighbourCoordinateMap = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [0, -1],
    [0, 1],
    [-1, 1],
    [0, 1],
    [1, 1],
] as const;

export async function generateSignature(input:
    | Buffer
    | ArrayBuffer
    | Uint8Array
    | Uint8ClampedArray
    | Int8Array
    | Uint16Array
    | Int16Array
    | Uint32Array
    | Int32Array
    | Float32Array
    | Float64Array
    | string
    | sharp.Sharp,

    options?: {
        enableAutocrop?: boolean,
        gridSize?: number,
        noiseCutoff?: number,
        sampleSizeRatio?: number,
        time?: boolean,

        debug_getLuma?: (r: number, g: number, b: number) => number,
        debug_makeGrayscale?: boolean,
        debug_doGamma?: boolean,
    }
): Promise<Int8Array<ArrayBuffer> & ArrayLike<LuminosityLevel> & Iterable<LuminosityLevel>> {
    const { enableAutocrop, gridSize, noiseCutoff, sampleSizeRatio, time, debug_getLuma, debug_makeGrayscale, debug_doGamma } = Object.assign({
        enableAutocrop: true,
        gridSize: 9,
        noiseCutoff: 2.0,
        sampleSizeRatio: 2.0,
        time: false,
        debug_getLuma: getLuma,
        debug_makeGrayscale: false,
        debug_doGamma: false,
    }, options ?? {});
    // Step 1: Generate a vector of double values representing the signature

    // Step 1.1: Crop the view to the relevant content

    // Pixel ordering is left-to-right, top-to-bottom, without padding. Channel ordering will be RGB or RGBA for non-greyscale colourspaces.
    if (time) console.time('load image, convert to luma and to buffer');
    let img = (typeof input !== 'string' && 'removeAlpha' in input ? input : sharp(input));

    if (debug_makeGrayscale || debug_doGamma)
        img = img
            .gamma(1.32);

    img = img
        .resize({ position: enableAutocrop ? sharp.strategy.entropy : undefined })
        .toColourspace('srgb');

    if (debug_makeGrayscale)
        img
            .greyscale()
            .toColourspace('b-w');

    const sharpBuf = await img
        .raw()
        .toBuffer({ resolveWithObject: true });

    const lumas = debug_makeGrayscale ? new Uint8ClampedArray(sharpBuf.data) : makeLumaArray(sharpBuf);

    function makeLumaArray(image: { data: Buffer; info: sharp.OutputInfo; }) {
        const stride = image.info.channels;
        const pixelArray = new Uint8ClampedArray(image.data);

        const lumaArray = new Uint8ClampedArray(image.info.width * image.info.height);

        for (let y = 0; y < image.info.height; y++)
        for (let x = 0; x < image.info.width; x++) {
            const p = x + (y * image.info.width);
            const start = p * stride;

            lumaArray[p] = debug_getLuma(pixelArray[start], pixelArray[start + 1], pixelArray[start + 2]);
        }

        return lumaArray;
    }

    if (time) console.timeEnd('load image, convert to luma and to buffer');

    /*if (sharpBuf.info.channels < 3) {
        sharpBuf = await sharp(input, { raw: sharpBuf.info })
            .raw()
            .toBuffer({ resolveWithObject: true });
    }*/

    // Step 1.2: Compute the average levels of points in the structure
    if (time) console.time('computeAverageSampleLuminosities');
    const sampledSquareAverages = computeAverageSampleLuminosities(sharpBuf, lumas);
    if (time) console.timeEnd('computeAverageSampleLuminosities');

    if (time) console.time('computeNeighbourDifferences');
    const luminosityDifferences = computeNeighbourDifferences(sampledSquareAverages);
    if (time) console.timeEnd('computeNeighbourDifferences');

    // Step 2: Generate a vector of values representing the signature from the vector of double values
    if (time) console.time('computeRelativeLuminosityLevels');
    const result = computeRelativeLuminosityLevels(luminosityDifferences);
    if (time) console.timeEnd('computeRelativeLuminosityLevels');

    return result;

    function computeAverageSampleLuminosities(
        image: { data: Buffer; info: sharp.OutputInfo; },
        pixelArray: Uint8ClampedArray,
    ) {
        // const pixelArray = new Uint8ClampedArray(image.data.buffer);
        const { width, height, channels } = image.info;

        const squareSize = Math.max(
            2.0,
            Math.round(Math.min(width, height) / ((gridSize + 1) * sampleSizeRatio))
        );

        const squareCenters = new Float32Array(gridSize * gridSize * 2);
        computeSquareCenters(squareCenters, sharpBuf);

        const sampleLuminosities = new Float16Array(squareCenters.length / 2);
        for (let i = 0; i < squareCenters.length; i += 2) {
            const squareX = squareCenters[i];
            const squareY = squareCenters[i + 1];
            sampleLuminosities[i / 2] = computeSquareAverage(image, pixelArray, squareX, squareY, squareSize);
        }

        return sampleLuminosities;
    }

    function* computeSquareCenters(
        outArr: Float32Array,
        { info: { width, height } }: {
            data: Buffer;
            info: sharp.OutputInfo;
        }
    ) {
        const widthOffset = (width / (gridSize + 1)); // float
        const heightOffset = (height / (gridSize + 1)); // float

        for (let x = 0; x < gridSize; ++x) {
            for (let y = 0; y < gridSize; ++y) {
                outArr[(x + (gridSize * y)) * 2] = widthOffset * (x + 1);
                outArr[(x + (gridSize * y)) * 2 + 1] = heightOffset * (y + 1);
            }
        }
    }

    function computeSquareAverage(
        image: { data: Buffer; info: sharp.OutputInfo; },
        pixelArray: Uint8ClampedArray,
        squareX: number,
        squareY: number,
        squareSize: number
    ) {
        const squareCorner = [
            Math.round(squareX - (squareSize / 2.0)),
            Math.round(squareY - (squareSize / 2.0))
        ];

        let count = 0;
        let sum = 0.0;
        for (let y = squareCorner[1]; y < squareCorner[1] + squareSize; ++y) {
            if (y > image.info.height || y < 0) {
                continue;
            }

            for (let x = squareCorner[0]; x < squareCorner[0] + squareSize; ++x) {
                if (x > image.info.width || x < 0) {
                    continue;
                }

                sum += sample3x3Point(image, pixelArray, [x, y]);
                ++count;
            }
        }

        return sum / count;
    }

    function sample3x3Point(image: { data: Buffer; info: sharp.OutputInfo; }, pixelArray: Uint8ClampedArray, point: [x: number, y: number]) {
        let sum = 0.0;

        for (let heightOffset = 0; heightOffset < 3; ++heightOffset) {
            const [pointX, pointY] = point;
            const y = (pointY - 1) + heightOffset;

            if (y > image.info.height - 1 || y < 0) {
                continue;
            }

            for (let widthOffset = 0; widthOffset < 3; ++widthOffset) {
                const x = (pointX - 1) + widthOffset;

                if (x > image.info.width - 1 || x < 0) {
                    continue;
                }

                const spandex = x + (y * image.info.width);
                sum += pixelArray[spandex];
            }
        }

        return sum / 9;
    }

    function computeNeighbourDifferences(luminosityAverages: Float16Array) {
        const neighbourDifferences = new Float16Array(gridSize * gridSize * 8);
        let spandex = 0;

        for (let x = 0; x < gridSize; ++x) {
            for (let y = 0; y < gridSize; ++y) {
                const index = x + (gridSize * y);

                const baseLuminosity = luminosityAverages[index];

                for (let i = 0; i < 8; ++i) {
                    const [tileX, tileY] = neighbourCoordinateMap[i];
                    const [neighbourX, neighbourY] = [x + tileX, y + tileY];

                    const neighbourIndex = neighbourX + (gridSize * neighbourY);
                    if (neighbourIndex < 0 || neighbourIndex >= luminosityAverages.length) {
                        neighbourDifferences[spandex] = 0.0;
                    } else {
                        neighbourDifferences[spandex] = baseLuminosity - luminosityAverages[neighbourIndex];
                    }

                    ++spandex;
                }
            }
        }

        return neighbourDifferences;
    }

    function computeRelativeLuminosityLevels(neighbourDifferences: Iterable<number> & ArrayLike<number>) {
        const darks = new Float16Array(neighbourDifferences.length);
        const lights = new Float16Array(neighbourDifferences.length);

        let cntDarks = 0;
        let cntLights = 0;
        for (const difference of neighbourDifferences) {
            if (difference >= -noiseCutoff && difference <= noiseCutoff) {
                // This difference is considered a samey value.
                continue;
            }

            if (difference < noiseCutoff) {
                darks[cntDarks++] = difference;
                continue;
            }

            if (difference > noiseCutoff) {
                lights[cntLights++] = difference;
            }
        }

        const muchDarkerCutoff = darks.length > 0 ? median(darks.slice(0, cntDarks)) : -noiseCutoff;
        const muchLighterCutoff = lights.length > 0 ? median(lights.slice(0, cntLights)) : noiseCutoff;

        const luminosityLevels = new Int8Array(neighbourDifferences.length);
        for (let i = 0; i < neighbourDifferences.length; i++) {
            const difference = neighbourDifferences[i];
            if (difference >= -noiseCutoff && difference <= noiseCutoff) {
                luminosityLevels[i] = LuminosityLevel.Same;
                continue;
            }

            if (difference < 0.0) {
                luminosityLevels[i] = difference < muchDarkerCutoff
                    ? LuminosityLevel.MuchDarker
                    : LuminosityLevel.Darker;

                continue;
            }

            luminosityLevels[i] = difference > muchLighterCutoff
                ? LuminosityLevel.MuchLighter
                : LuminosityLevel.Lighter;
        }

        return luminosityLevels;
    }
}

function sRGBtoLin(colorChannel: number) {
    if (colorChannel <= 0.04045) {
        return colorChannel / 12.92;
    } else {
        return Math.pow(((colorChannel + 0.055) / 1.055), 2.4);
    }
}

function getLuma(r: number, g: number, b: number) { // from imagesharp (TODO check license)
    // return ((sRGBtoLin(r) * 0.2126) + (sRGBtoLin(g) * 0.7152) + (sRGBtoLin(b) * 0.0722) + 0.5);
    // (unsigned char) ((gdimage->red[pixel] * 77 + gdimage->green[pixel] * 151 + gdimage->blue[pixel] * 28 + 128) / 256);
    // return (((r * 77) + (g * 151) + (b * 28) + 128) / 256); // from libpuzzle
    // return (0.2125 * r) + (0.7154 * g) + (0.0721 * b); // from skimage
    return .299 * r + .587 * g + .114 * b; // i forgor

    // https://github.com/micjahn/ZXing.Net/blob/master/Source/Bindings/ZXing.ImageSharp/ImageSharpLuminanceSource.cs
    // let luminance = (b * 7424 + g * 38550 + r * 19562) >> 16;
    // const alpha = 255;
    // luminance = Math.floor(((luminance * alpha) >> 8) + (255 * (255 - alpha) >> 8) + 1);
    // return luminance;
}

function median(source: Float16Array) {
    const sorted = source.sort((a, b) => a - b);

    if (sorted.length == 1) {
        return sorted[0];
    }

    const halfwayIndex = sorted.length / 2;

    if (sorted.length % 2 == 0) {
        return sorted[halfwayIndex];
    }

    return (sorted[halfwayIndex] + sorted[halfwayIndex - 1]) / 2.0;
}

export const enum LuminosityLevel {
    /** The neighbour is much darker than the base point. */
    MuchDarker = -2,

    /** The neighbour is darker than the base point. */
    Darker = -1,

    /** The neighbour is of same or similar luminosity as the base point. */
    Same = 0,

    /** The neighbour is lighter than the base point. */
    Lighter = 1,

    /** The neighbour is much lighter than the base point. */
    MuchLighter = 2
}

/**
 * Encodes luminosity levels to an ArrayBuffer. if levels.length is not a multiple of 4, it will be padded with LuminosityLevel.Same.
 * @param levels
 */
export function encodeToBitArray(levels: ArrayLike<LuminosityLevel>): ArrayBuffer {
    const bitArray = new Uint8ClampedArray(levels.length / 4);

    const rem = levels.length % 4;
    for (let i = 0, j = 0; i < levels.length; i += 4, j++) {
        if (rem === 0) {
            bitArray[j] = (levels[i] + 2) | ((levels[i + 1] + 2) << 2) | ((levels[i + 2] + 2) << 4) | ((levels[i + 3] + 2) << 6);
        } else if (rem === 1) {
            bitArray[j] = (levels[i] + 2) | ((levels[i + 1] + 2) << 2) | ((levels[i + 2] + 2) << 4);
        } else if (rem === 2) {
            bitArray[j] = (levels[i] + 2) | ((levels[i + 1] + 2) << 2);
        } else if (rem === 3) {
            bitArray[j] = (levels[i] + 2);
        }
    }

    return bitArray.buffer;
}

/**
 * Decodes luminosity levels from an ArrayBuffer.
 * @param levels
 */
export function decodeFromBitArray(array: ArrayBufferLike): ArrayLike<LuminosityLevel> {
    const bitArray = new Uint8ClampedArray(array);

    const levels = new Int8Array(array.byteLength * 4);

    for (let i = 0, j = 0; i < levels.length; i++) {
        levels[j] = (bitArray[i] & 2) - 2;
        levels[j + 1] = ((bitArray[i] >> 2) & 2) - 2;
        levels[j + 2] = ((bitArray[i] >> 4) & 2) - 2;
        levels[j + 3] = ((bitArray[i] >> 6) & 2) - 2;
        j += 4;
    }

    return levels;
}

export const enum SignatureSimilarity {
    /* The images are identical. */
    Identical = 'identical',

    /* The image is the same image. */
    Same = 'same',

    /* The images are similar. */
    Similar = 'similar',

    /* The images are dissimilar. */
    Dissimilar = 'dissimilar',

    /* The images are different images. */
    Different = 'different'
}

export function compareSimilarity(
    left: ArrayLike<LuminosityLevel> & Iterable<LuminosityLevel>,
    right: ArrayLike<LuminosityLevel> & Iterable<LuminosityLevel>,
    sameThreshold = 0.4,
    similarityThreshold = 0.48,
    dissimilarThreshold = 0.68,
    differentThreshold = 0.7
) {
    const distance = normalizedDistance(left, right);
    console.log(distance);

    if (distance <= 0.0) return SignatureSimilarity.Identical;
    if (distance <= sameThreshold) return SignatureSimilarity.Same;
    if (distance <= similarityThreshold) return SignatureSimilarity.Similar;
    if (distance <= dissimilarThreshold) return SignatureSimilarity.Dissimilar;
    if (distance <= differentThreshold) return SignatureSimilarity.Different;
    else return SignatureSimilarity.Different;
}


/// <summary>
/// Calculates the euclidean length of an image signature.
/// </summary>
/// <param name="signature">The signature.</param>
/// <returns>The euclidean length of the vector.</returns>
function euclideanLength(signature: ArrayLike<number> & Iterable<number>) {
    let sum = 0.0;
    for (const val of signature) {
        sum += val * val; // Math.Pow(val, 2);
    }

    return Math.sqrt(sum);
}

/// <summary>
/// Subtracts one signature vector from another.
/// </summary>
/// <param name="left">The left signature.</param>
/// <param name="right">The right signature.</param>
/// <returns>The subtracted signature.</returns>
function subtract(left: ArrayLike<LuminosityLevel> & Iterable<LuminosityLevel>, right: ArrayLike<LuminosityLevel> & Iterable<LuminosityLevel>) {
    const result = new Int8Array(left.length);

    for (let i = 0; i < left.length; i++) {
        const leftValue = left[i];

        if (i >= right.length) {
            result[i] = leftValue;
            continue;
        }

        const rightValue = right[i];

        if ((leftValue == 0 && rightValue == LuminosityLevel.MuchDarker) || (leftValue == LuminosityLevel.MuchDarker && rightValue == 0)) {
            result[i] = -3;
            continue;
        } else if ((leftValue == 0 && rightValue == LuminosityLevel.MuchLighter) || (leftValue == LuminosityLevel.MuchLighter && rightValue == 0)) {
            result[i] = 3;
            continue;
        } else {
            result[i] = (leftValue - rightValue);
            continue;
        }
    }

    return result;
}

/// <summary>
/// Computes the normalized distance between two signatures.
/// </summary>
/// <param name="left">The left signature.</param>
/// <param name="right">The right signature.</param>
/// <returns>The normalized distance.</returns>
export function normalizedDistance(
    left: ArrayLike<LuminosityLevel> & Iterable<LuminosityLevel>,
    right: ArrayLike<LuminosityLevel> & Iterable<LuminosityLevel>,
) {
    const subtractedVectors = subtract(left, right);
    const subtractedLength = euclideanLength(subtractedVectors);

    const combinedLength = euclideanLength(left) + euclideanLength(right);

    // ReSharper disable once CompareOfFloatsByEqualityOperator
    if (combinedLength == 0.0) {
        return 0.0;
    }

    return subtractedLength / combinedLength;
}

export const enum ClampValue {
    /** The neighbour is different than the base point. */
    Different = 1,

    /** The neighbour is much different than the base point. */
    MuchDifferent = 2
}

export function clampLuminosity<T extends { [n: number]: LuminosityLevel, length: number }>(
    levels: T,
    clampValue: ClampValue
): T {
    for (let i = 0; i < levels.length; i++) {
        const level = levels[i];
        if (Math.abs(level) <= clampValue) {
            levels[i] = LuminosityLevel.Same;
        }
    }
    return levels;
}
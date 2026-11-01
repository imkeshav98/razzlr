/*
 * Bindings for Skia's PDF and SVG backends, which npm's CanvasKit leaves out. Each document hands out
 * an ordinary CanvasKit Canvas, so the same drawing code that draws on a surface draws into the file.
 * DrawTextAsPaths draws a picture's text as shapes, for text a PDF must not hold twice.
 */

#include "include/core/SkCanvas.h"
#include "include/core/SkData.h"
#include "include/core/SkDocument.h"
#include "include/core/SkFont.h"
#include "include/core/SkPath.h"
#include "include/core/SkPathBuilder.h"
#include "include/core/SkPicture.h"
#include "include/core/SkPixmap.h"
#include "include/core/SkRect.h"
#include "include/core/SkRefCnt.h"
#include "include/core/SkStream.h"
#include "include/core/SkString.h"
#include "include/docs/SkPDFDocument.h"
#include "include/docs/SkPDFJpegHelpers.h"
#include "include/encode/SkPngEncoder.h"
#include "include/svg/SkSVGCanvas.h"
#include "include/utils/SkNWayCanvas.h"
#include "src/core/SkTextBlobPriv.h"

#include <emscripten.h>
#include <emscripten/bind.h>

#include <memory>
#include <optional>
#include <string>
#include <vector>

using namespace emscripten;

namespace {

val bytesOf(SkDynamicMemoryWStream& stream) {
    sk_sp<SkData> data = stream.detachAsData();
    // slice() copies the bytes out of wasm memory before the data is freed.
    return val(typed_memory_view(data->size(), data->bytes())).call<val>("slice");
}

struct PDFOptions {
    std::string title;
    std::string author;
    std::string creator;
    std::string producer;
    std::string lang;
    float rasterDPI;
    int encodingQuality;
};

class PDFDocument {
public:
    explicit PDFDocument(const PDFOptions& options) {
        SkPDF::Metadata metadata = SkPDF::JPEG::MetadataWithCallbacks();
        metadata.fTitle = SkString(options.title.c_str());
        metadata.fAuthor = SkString(options.author.c_str());
        metadata.fCreator = SkString(options.creator.c_str());
        metadata.fProducer = SkString(options.producer.c_str());
        metadata.fLang = SkString(options.lang.c_str());
        metadata.fRasterDPI = options.rasterDPI;
        metadata.fEncodingQuality = options.encodingQuality;
        fDocument = SkPDF::MakeDocument(&fStream, metadata);
    }

    SkCanvas* beginPage(float width, float height) {
        return fDocument ? fDocument->beginPage(width, height) : nullptr;
    }

    void endPage() {
        if (fDocument) {
            fDocument->endPage();
        }
    }

    val close() {
        if (!fDocument) {
            return val::null();
        }
        fDocument->close();
        fDocument = nullptr;
        return bytesOf(fStream);
    }

private:
    SkDynamicMemoryWStream fStream;
    sk_sp<SkDocument> fDocument;
};

bool encodePng(SkWStream* dst, const SkPixmap& src) {
    return SkPngEncoder::Encode(dst, src, SkPngEncoder::Options());
}

class SVGDocument {
public:
    SVGDocument(float width, float height, uint32_t flags) {
        SkSVGCanvas::Options options;
        options.flags = static_cast<SkSVGCanvas::Flags>(flags);
        options.pngEncoder = encodePng;
        fCanvas = SkSVGCanvas::Make(SkRect::MakeWH(width, height), &fStream, options);
    }

    SkCanvas* canvas() { return fCanvas.get(); }

    val close() {
        if (!fCanvas) {
            return val::null();
        }
        // The SVG is only complete once its canvas is gone.
        fCanvas.reset();
        return bytesOf(fStream);
    }

private:
    SkDynamicMemoryWStream fStream;
    std::unique_ptr<SkCanvas> fCanvas;
};

// Passes every draw on to its target canvas, except text, which it draws as the glyphs' outlines
// with the text's own paint, so a stroked paint strokes them.
class TextAsPathsCanvas final : public SkNWayCanvas {
public:
    explicit TextAsPathsCanvas(SkCanvas* target) : SkNWayCanvas(kReach, kReach) {
        this->addCanvas(target);
    }

protected:
    void onDrawTextBlob(const SkTextBlob* blob, SkScalar x, SkScalar y, const SkPaint& paint) override {
        SkPathBuilder outlines;
        for (SkTextBlobRunIterator run(blob); !run.done(); run.next()) {
            const SkFont& font = run.font();
            const size_t count = run.glyphCount();
            const SkPoint origin = run.offset() + SkPoint::Make(x, y);
            std::vector<SkPoint> at(count);
            switch (run.positioning()) {
                case SkTextBlobRunIterator::kDefault_Positioning:
                    font.getPos({run.glyphs(), count}, at, origin);
                    break;
                case SkTextBlobRunIterator::kHorizontal_Positioning:
                    for (size_t i = 0; i < count; ++i) {
                        at[i] = SkPoint::Make(origin.x() + run.pos()[i], origin.y());
                    }
                    break;
                case SkTextBlobRunIterator::kFull_Positioning:
                    for (size_t i = 0; i < count; ++i) {
                        at[i] = origin + run.points()[i];
                    }
                    break;
                default:
                    // Turned glyphs stay text; our text never turns them.
                    this->SkNWayCanvas::onDrawTextBlob(blob, x, y, paint);
                    return;
            }
            for (size_t i = 0; i < count; ++i) {
                if (std::optional<SkPath> glyph = font.getPath(run.glyphs()[i])) {
                    outlines.addPath(*glyph, at[i].x(), at[i].y());
                }
            }
        }
        this->drawPath(outlines.detach(), paint);
    }

private:
    // Wide enough that nothing drawn is ever cut by this canvas's own bounds.
    static constexpr int kReach = 1 << 20;
};

void drawTextAsPaths(SkCanvas* target, sk_sp<SkPicture> picture) {
    if (!target || !picture) {
        return;
    }
    TextAsPathsCanvas canvas(target);
    picture->playback(&canvas);
}

}  // namespace

EMSCRIPTEN_BINDINGS(VectorDocuments) {
    value_object<PDFOptions>("PDFOptions")
            .field("title", &PDFOptions::title)
            .field("author", &PDFOptions::author)
            .field("creator", &PDFOptions::creator)
            .field("producer", &PDFOptions::producer)
            .field("lang", &PDFOptions::lang)
            .field("rasterDPI", &PDFOptions::rasterDPI)
            .field("encodingQuality", &PDFOptions::encodingQuality);

    class_<PDFDocument>("PDFDocument")
            .constructor<const PDFOptions&>()
            .function("beginPage", &PDFDocument::beginPage, allow_raw_pointers())
            .function("endPage", &PDFDocument::endPage)
            .function("close", &PDFDocument::close);

    class_<SVGDocument>("SVGDocument")
            .constructor<float, float, uint32_t>()
            .function("canvas", &SVGDocument::canvas, allow_raw_pointers())
            .function("close", &SVGDocument::close);

    function("DrawTextAsPaths", &drawTextAsPaths, allow_raw_pointers());

    constant("SVG_CONVERT_TEXT_TO_PATHS", static_cast<uint32_t>(SkSVGCanvas::kConvertTextToPaths_Flag));
    constant("SVG_NO_PRETTY_XML", static_cast<uint32_t>(SkSVGCanvas::kNoPrettyXML_Flag));
    constant("SVG_RELATIVE_PATH_ENCODING", static_cast<uint32_t>(SkSVGCanvas::kRelativePathEncoding_Flag));
}

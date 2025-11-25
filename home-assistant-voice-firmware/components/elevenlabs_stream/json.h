
// json.h

#pragma once
#include <esphome/components/json/json_util.h>
#include <cstddef>
#include <string>
#include <memory>
#include <esp_heap_caps.h>

namespace esphome {
namespace elevenlabs_stream {

// Allocator for PSRAM with fallback to regular heap
struct PSRAMAllocator {
    void *allocate(size_t size) {
        // Try PSRAM first
        void* ptr = heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
        if (!ptr) {
            // Fallback to regular heap if PSRAM fails
            ptr = heap_caps_malloc(size, MALLOC_CAP_8BIT);
            if (ptr) {
                ESP_LOGW("PSRAMAllocator", "PSRAM allocation failed, using regular heap for %zu bytes", size);
            }
        }
        return ptr;
    }
    void deallocate(void *pointer) {
        heap_caps_free(pointer);
    }
    void *reallocate(void *ptr, size_t new_size) {
        // Try PSRAM first
        void* new_ptr = heap_caps_realloc(ptr, new_size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
        if (!new_ptr) {
            // Fallback to regular heap if PSRAM fails
            new_ptr = heap_caps_realloc(ptr, new_size, MALLOC_CAP_8BIT);
            if (new_ptr) {
                ESP_LOGW("PSRAMAllocator", "PSRAM reallocation failed, using regular heap for %zu bytes", new_size);
            }
        }
        return new_ptr;
    }
};

class JsonDeserializer {
public:
    // Parses a JSON buffer and returns a unique_ptr to the document. Returns nullptr on error.
    static std::unique_ptr<BasicJsonDocument<PSRAMAllocator>> parse(const uint8_t* buffer, size_t length);
    static std::unique_ptr<BasicJsonDocument<PSRAMAllocator>> parse(const char* cstr);
    
    // Serialize a JsonObject to a std::string
    static std::string to_string(const JsonObject& obj);
};

} // namespace elevenlabs_stream
} // namespace esphome

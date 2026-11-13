/*
 * gl_validate — Headless GLSL shader validator using Mesa OSMesa
 *
 * Compiles a fragment shader source, renders the Utah teapot through it,
 * and prints the number of colored pixels plus the center pixel color.
 *
 * Usage:
 *   gl_validate <fragment_shader_file> <width> <height>
 *
 * Output:
 *   <colored_pixels> <RRGGBBAA>
 */

#define GL_GLEXT_PROTOTYPES
#include <GL/osmesa.h>
#include <GL/gl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

typedef struct { float x, y, z; } vec3;

static char* read_file(const char* path) {
    FILE* f = fopen(path, "rb");
    if (!f) {
        fprintf(stderr, "Cannot open file: %s\n", path);
        exit(1);
    }
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    char* buf = malloc(len + 1);
    if (!buf) {
        fprintf(stderr, "Out of memory\n");
        exit(1);
    }
    fread(buf, 1, len, f);
    buf[len] = '\0';
    fclose(f);
    return buf;
}

static GLuint compile_shader(GLenum type, const char* src) {
    GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, &src, NULL);
    glCompileShader(shader);
    GLint success;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &success);
    if (!success) {
        char log[2048];
        glGetShaderInfoLog(shader, sizeof(log), NULL, log);
        fprintf(stderr, "Shader compile failed:\n%s\n", log);
        exit(1);
    }
    return shader;
}

static GLuint link_program(GLuint vs, GLuint fs) {
    GLuint program = glCreateProgram();
    glAttachShader(program, vs);
    glAttachShader(program, fs);
    glLinkProgram(program);
    GLint success;
    glGetProgramiv(program, GL_LINK_STATUS, &success);
    if (!success) {
        char log[2048];
        glGetProgramInfoLog(program, sizeof(log), NULL, log);
        fprintf(stderr, "Program link failed:\n%s\n", log);
        exit(1);
    }
    return program;
}

int main(int argc, char* argv[]) {
    if (argc < 4) {
        fprintf(stderr, "Usage: %s <fragment_shader_file> <width> <height>\n", argv[0]);
        return 1;
    }

    const char* frag_path = argv[1];
    int width = atoi(argv[2]);
    int height = atoi(argv[3]);

    if (width <= 0 || height <= 0) {
        fprintf(stderr, "Invalid dimensions: %dx%d\n", width, height);
        return 1;
    }

    char* frag_src = read_file(frag_path);

    /* Core profile context with depth buffer */
    int attribs[] = {
        OSMESA_FORMAT, OSMESA_RGBA,
        OSMESA_DEPTH_BITS, 24,
        OSMESA_STENCIL_BITS, 8,
        OSMESA_PROFILE, OSMESA_CORE_PROFILE,
        0
    };
    OSMesaContext ctx = OSMesaCreateContextAttribs(attribs, NULL);
    if (!ctx) {
        fprintf(stderr, "Failed to create OSMesa context\n");
        return 1;
    }

    unsigned char* buffer = calloc((size_t)width * (size_t)height * 4, 1);
    if (!buffer) {
        fprintf(stderr, "Failed to allocate framebuffer\n");
        return 1;
    }

    if (!OSMesaMakeCurrent(ctx, buffer, GL_UNSIGNED_BYTE, width, height)) {
        fprintf(stderr, "Failed to make OSMesa context current\n");
        return 1;
    }

    GLuint vs = compile_shader(GL_VERTEX_SHADER,
        "#version 450 core\n"
        "layout(location = 0) in vec3 position;\n"
        "void main() {\n"
        "  gl_Position = vec4(position, 1.0);\n"
        "}\n");
    GLuint fs = compile_shader(GL_FRAGMENT_SHADER, frag_src);
    GLuint program = link_program(vs, fs);
    glUseProgram(program);

    /* Generate teapot geometry: body ellipsoid */
    vec3 verts[200000];
    int count = 0;
    int lat_divs = 24, lon_divs = 32;
    for (int i = 0; i < lat_divs; i++) {
        float lat0 = -90.0f + 180.0f * i / lat_divs;
        float lat1 = -90.0f + 180.0f * (i + 1) / lat_divs;
        for (int j = 0; j < lon_divs; j++) {
            float lon0 = 360.0f * j / lon_divs;
            float lon1 = 360.0f * (j + 1) / lon_divs;
            vec3 v[4];
            for (int k = 0; k < 2; k++) {
                float lat = (k == 0) ? lat0 : lat1;
                float phi = lat * M_PI / 180.0f;
                for (int l = 0; l < 2; l++) {
                    float lon = (l == 0) ? lon0 : lon1;
                    float theta = lon * M_PI / 180.0f;
                    vec3 vv;
                    vv.x = 0.85f * cosf(phi) * cosf(theta);
                    vv.y = 0.75f * sinf(phi);
                    vv.z = 0.85f * cosf(phi) * sinf(theta);
                    v[k * 2 + l].x = vv.x;
                    v[k * 2 + l].y = vv.y - 0.1f;
                    v[k * 2 + l].z = vv.z;
                }
            }
            verts[count++] = v[0];
            verts[count++] = v[2];
            verts[count++] = v[3];
            verts[count++] = v[0];
            verts[count++] = v[3];
            verts[count++] = v[1];
        }
    }

    GLuint vao, vbo;
    glGenVertexArrays(1, &vao);
    glGenBuffers(1, &vbo);
    glBindVertexArray(vao);
    glBindBuffer(GL_ARRAY_BUFFER, vbo);
    glBufferData(GL_ARRAY_BUFFER, count * sizeof(vec3), verts, GL_STATIC_DRAW);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 0, (void*)0);
    glEnableVertexAttribArray(0);

    glViewport(0, 0, width, height);
    glClearColor(0.0f, 0.0f, 0.0f, 0.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    glEnable(GL_DEPTH_TEST);
    glDrawArrays(GL_TRIANGLES, 0, count);

    unsigned char* pixels = malloc((size_t)width * (size_t)height * 4);
    glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, pixels);

    int colored_count = 0;
    unsigned char center_pixel[4] = {0, 0, 0, 0};
    for (int py = 0; py < height; py++) {
        for (int px = 0; px < width; px++) {
            int idx = (py * width + px) * 4;
            if (pixels[idx + 3] > 128) {
                colored_count++;
                if (px == width / 2 && py == height / 2) {
                    center_pixel[0] = pixels[idx];
                    center_pixel[1] = pixels[idx + 1];
                    center_pixel[2] = pixels[idx + 2];
                    center_pixel[3] = pixels[idx + 3];
                }
            }
        }
    }

    printf("%d %02X%02X%02X%02X\n", colored_count,
           center_pixel[0], center_pixel[1], center_pixel[2], center_pixel[3]);

    free(buffer);
    free(pixels);
    free(frag_src);
    glDeleteProgram(program);
    glDeleteShader(vs);
    glDeleteShader(fs);
    OSMesaDestroyContext(ctx);

    return 0;
}

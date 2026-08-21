import { describe, expect, it, vi } from "vitest";
import { uploadAndAttachVesselPhotos, validateVesselImageFile } from "./upload-raw";
import { vesselImageMaxBytes } from "@/lib/validation/vessel";

function fakeFile(name: string, type: string, size: number): File {
  const file = new File([], name, { type });
  // jsdom computes `size` from the (empty) content passed to the File constructor — override it
  // directly rather than allocating a real multi-megabyte buffer just to test a boundary check.
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("validateVesselImageFile", () => {
  it("accepts a file within the size and type limits", () => {
    expect(validateVesselImageFile(fakeFile("cover.jpg", "image/jpeg", 2 * 1024 * 1024))).toBeNull();
  });

  it("rejects a file over the size cap", () => {
    expect(
      validateVesselImageFile(fakeFile("cover.jpg", "image/jpeg", vesselImageMaxBytes + 1)),
    ).toBe("tooLarge");
  });

  it("accepts a file exactly at the size cap", () => {
    expect(validateVesselImageFile(fakeFile("cover.jpg", "image/jpeg", vesselImageMaxBytes))).toBeNull();
  });

  it("rejects an unsupported MIME type", () => {
    expect(validateVesselImageFile(fakeFile("cover.heic", "image/heic", 1024))).toBe("invalidType");
  });
});

describe("uploadAndAttachVesselPhotos", () => {
  it("uploads and attaches every file, in order", async () => {
    const files = [fakeFile("a.jpg", "image/jpeg", 1024), fakeFile("b.jpg", "image/jpeg", 1024)];
    const calls: string[] = [];
    const upload = vi.fn(async (_vesselId: string, _vesselName: string, file: File) => {
      calls.push(`upload:${file.name}`);
      return { path: `staging/${file.name}` };
    });
    const attach = vi.fn(async (vesselId: string, rawPath: string) => {
      calls.push(`attach:${rawPath}`);
      return {};
    });

    const result = await uploadAndAttachVesselPhotos("vessel-1", "Adriatic Dream", files, attach, upload);

    expect(result).toEqual({});
    expect(calls).toEqual([
      "upload:a.jpg",
      "attach:staging/a.jpg",
      "upload:b.jpg",
      "attach:staging/b.jpg",
    ]);
    expect(attach).toHaveBeenCalledWith("vessel-1", "staging/a.jpg");
    expect(attach).toHaveBeenCalledWith("vessel-1", "staging/b.jpg");
  });

  it("does nothing and succeeds trivially when there are no files", async () => {
    const upload = vi.fn();
    const attach = vi.fn();
    const result = await uploadAndAttachVesselPhotos("vessel-1", "Adriatic Dream", [], attach, upload);
    expect(result).toEqual({});
    expect(upload).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
  });

  it("stops at the first upload failure and never attaches that file or any later one", async () => {
    const files = [fakeFile("a.jpg", "image/jpeg", 1024), fakeFile("b.jpg", "image/jpeg", 1024)];
    const upload = vi
      .fn()
      .mockResolvedValueOnce({ error: "tooLarge" })
      .mockResolvedValueOnce({ path: "staging/b.jpg" });
    const attach = vi.fn(async () => ({}));

    const result = await uploadAndAttachVesselPhotos("vessel-1", "Adriatic Dream", files, attach, upload);

    expect(result).toEqual({ error: "tooLarge" });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(attach).not.toHaveBeenCalled();
  });

  it("stops at the first attach failure and never uploads a later file", async () => {
    const files = [fakeFile("a.jpg", "image/jpeg", 1024), fakeFile("b.jpg", "image/jpeg", 1024)];
    const upload = vi.fn(async (_vesselId: string, _vesselName: string, file: File) => ({
      path: `staging/${file.name}`,
    }));
    const attach = vi.fn().mockResolvedValueOnce({ error: "generic" });

    const result = await uploadAndAttachVesselPhotos("vessel-1", "Adriatic Dream", files, attach, upload);

    expect(result).toEqual({ error: "generic" });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it("reports a generic error when upload succeeds but returns no path", async () => {
    const files = [fakeFile("a.jpg", "image/jpeg", 1024)];
    const upload = vi.fn(async () => ({}));
    const attach = vi.fn(async () => ({}));

    const result = await uploadAndAttachVesselPhotos("vessel-1", "Adriatic Dream", files, attach, upload);

    expect(result).toEqual({ error: "generic" });
    expect(attach).not.toHaveBeenCalled();
  });

  it("reports progress after each file finishes uploading and attaching, not before", async () => {
    const files = [fakeFile("a.jpg", "image/jpeg", 1024), fakeFile("b.jpg", "image/jpeg", 1024)];
    const upload = vi.fn(async (_vesselId: string, _vesselName: string, file: File) => ({
      path: `staging/${file.name}`,
    }));
    const attach = vi.fn(async () => ({}));
    const onProgress = vi.fn();

    await uploadAndAttachVesselPhotos("vessel-1", "Adriatic Dream", files, attach, upload, onProgress);

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2);
    expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2);
  });

  it("never reports the failed file as progress when a later file's attach fails", async () => {
    const files = [fakeFile("a.jpg", "image/jpeg", 1024), fakeFile("b.jpg", "image/jpeg", 1024)];
    const upload = vi.fn(async (_vesselId: string, _vesselName: string, file: File) => ({
      path: `staging/${file.name}`,
    }));
    const attach = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ error: "generic" });
    const onProgress = vi.fn();

    await uploadAndAttachVesselPhotos("vessel-1", "Adriatic Dream", files, attach, upload, onProgress);

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(1, 2);
  });
});

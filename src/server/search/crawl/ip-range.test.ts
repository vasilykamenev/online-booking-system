import { describe, expect, it } from "vitest";
import { isPrivateIp, isPrivateIpv4, isPrivateIpv6 } from "./ip-range";

describe("isPrivateIpv4", () => {
  it("blocks loopback", () => {
    expect(isPrivateIpv4("127.0.0.1")).toBe(true);
  });

  it("blocks the cloud metadata link-local address", () => {
    // 169.254.169.254 is how AWS/GCP/Azure expose instance credentials — the single most
    // dangerous SSRF target on the whole list.
    expect(isPrivateIpv4("169.254.169.254")).toBe(true);
  });

  it("blocks all three RFC 1918 private ranges", () => {
    expect(isPrivateIpv4("10.1.2.3")).toBe(true);
    expect(isPrivateIpv4("172.16.0.1")).toBe(true);
    expect(isPrivateIpv4("172.31.255.255")).toBe(true);
    expect(isPrivateIpv4("192.168.1.1")).toBe(true);
  });

  it("does not block an address just outside the 172.16.0.0/12 boundary", () => {
    expect(isPrivateIpv4("172.32.0.1")).toBe(false);
    expect(isPrivateIpv4("172.15.255.255")).toBe(false);
  });

  it("allows an ordinary public address", () => {
    expect(isPrivateIpv4("93.184.216.34")).toBe(false);
  });

  it("treats an unparseable string as not-private rather than throwing", () => {
    expect(isPrivateIpv4("not-an-ip")).toBe(false);
  });
});

describe("isPrivateIpv6", () => {
  it("blocks loopback and unspecified", () => {
    expect(isPrivateIpv6("::1")).toBe(true);
    expect(isPrivateIpv6("::")).toBe(true);
  });

  it("blocks link-local and unique-local", () => {
    expect(isPrivateIpv6("fe80::1")).toBe(true);
    expect(isPrivateIpv6("fd00::1")).toBe(true);
  });

  it("unwraps an IPv4-mapped address and checks it against the IPv4 ranges", () => {
    expect(isPrivateIpv6("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIpv6("::ffff:93.184.216.34")).toBe(false);
  });

  it("allows an ordinary public IPv6 address", () => {
    expect(isPrivateIpv6("2606:4700:4700::1111")).toBe(false);
  });
});

describe("isPrivateIp", () => {
  it("dispatches on the address family", () => {
    expect(isPrivateIp("10.0.0.1", 4)).toBe(true);
    expect(isPrivateIp("::1", 6)).toBe(true);
  });
});

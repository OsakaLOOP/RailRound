import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../ErrorBoundary";

function ThrowError() {
  throw new Error("boundary boom");
}

describe("blog mdx ErrorBoundary", () => {
  it("renders fallback ui when child throws", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByText("组件渲染遇到了点阻碍")).toBeInTheDocument();
    expect(screen.getByText("boundary boom")).toBeInTheDocument();

    consoleError.mockRestore();
  });

  it("renders custom fallback when provided", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    render(
      <ErrorBoundary fallback={<div>custom fallback</div>}>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByText("custom fallback")).toBeInTheDocument();
    expect(screen.queryByText("组件渲染遇到了点阻碍")).not.toBeInTheDocument();

    consoleError.mockRestore();
  });
});

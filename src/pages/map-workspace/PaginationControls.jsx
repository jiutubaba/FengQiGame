import { formatNumber } from "../../utils/format";

export default function PaginationControls({
  pagination,
  onPageChange,
  noun = "条记录",
}) {
  const page = Number(pagination?.page || 1);
  const limit = Number(pagination?.limit || 20);
  const total = Number(pagination?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const visibleCount = Math.min(5, totalPages);
  const firstPage = Math.min(
    Math.max(1, page - Math.floor(visibleCount / 2)),
    Math.max(1, totalPages - visibleCount + 1),
  );
  const pages = Array.from(
    { length: visibleCount },
    (_, index) => firstPage + index,
  );
  return (
    <div className="table-footer">
      <span>
        共 {formatNumber(total)} {noun} · 第 {page} / {totalPages} 页
      </span>
      <nav className="pagination" aria-label="分页">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          上一页
        </button>
        {pages.map((pageNumber) => (
          <button
            type="button"
            key={pageNumber}
            className={pageNumber === page ? "active" : ""}
            aria-current={pageNumber === page ? "page" : undefined}
            onClick={() => onPageChange(pageNumber)}
          >
            {pageNumber}
          </button>
        ))}
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          下一页
        </button>
      </nav>
    </div>
  );
}

package com.server.letMeCook.controller;

import com.server.letMeCook.service.RecipeService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class RecipeSortTests {
    @Test void deterministicTitleAndIdSortIsForwardedInOrder() {
        RecipeService service = mock(RecipeService.class);
        when(service.getAllRecipeDTOs(any(Pageable.class), isNull())).thenReturn(Page.empty());
        RecipeController controller = new RecipeController(service);
        controller.getAllRecipes(PageRequest.of(0, 500, Sort.by(Sort.Order.asc("title"), Sort.Order.asc("id"))), null);
        ArgumentCaptor<Pageable> page = ArgumentCaptor.forClass(Pageable.class);
        verify(service).getAllRecipeDTOs(page.capture(), isNull());
        assertEquals(List.of("title", "id"), page.getValue().getSort().stream().map(Sort.Order::getProperty).toList());
        assertTrue(page.getValue().getSort().stream().allMatch(Sort.Order::isAscending));
        assertEquals(500, page.getValue().getPageSize());
    }
    @Test void unlistedFieldsRemainRejectedBeforeRepositoryAccess() {
        RecipeService service = mock(RecipeService.class);
        RecipeController controller = new RecipeController(service);
        ResponseStatusException error = assertThrows(ResponseStatusException.class, () -> controller.getAllRecipes(
                PageRequest.of(0, 20, Sort.by("author.password")), null));
        assertEquals(HttpStatus.BAD_REQUEST, error.getStatusCode());
        verifyNoInteractions(service);
    }
}

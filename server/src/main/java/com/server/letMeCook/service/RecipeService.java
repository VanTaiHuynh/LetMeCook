package com.server.letMeCook.service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.LinkedHashSet;
import java.util.Arrays;
import java.util.Collection;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import com.server.letMeCook.repository.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import com.server.letMeCook.dto.recipe.RecipeCardDTO;
import com.server.letMeCook.dto.recipe.RecipeDTO;
import com.server.letMeCook.mapper.RecipeMapper;
import com.server.letMeCook.model.Category;
import com.server.letMeCook.model.Cuisine;
import com.server.letMeCook.model.DietaryPreference;
import com.server.letMeCook.model.Ingredient;
import com.server.letMeCook.model.Recipe;
import com.server.letMeCook.model.RecipeIngredient;
import com.server.letMeCook.model.User;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.TypedQuery;
import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.Expression;
import jakarta.persistence.criteria.Join;
import jakarta.persistence.criteria.JoinType;
import jakarta.persistence.criteria.Order;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import jakarta.persistence.criteria.Subquery;

@Service
public class RecipeService {

    private static final List<String> TREE_NUTS = List.of("almond", "walnut", "cashew", "pecan", "pistachio",
            "hazelnut", "brazil nut", "macadamia");
    private static final Map<String, List<String>> ALLERGEN_ALIASES = Map.ofEntries(
            Map.entry("dairy", List.of("milk", "butter", "cheese", "cream", "yogurt", "yoghurt", "ghee", "whey",
                    "casein", "buttermilk", "mascarpone", "mozzarella", "parmesan", "cheddar", "feta", "ricotta", "halloumi")),
            Map.entry("nut", List.of("peanut", "almond", "walnut", "cashew", "pecan", "pistachio", "hazelnut", "brazil nut", "macadamia")),
            Map.entry("nuts", List.of("peanut", "almond", "walnut", "cashew", "pecan", "pistachio", "hazelnut", "brazil nut", "macadamia")),
            Map.entry("tree nut", TREE_NUTS), Map.entry("tree nuts", TREE_NUTS),
            Map.entry("gluten", List.of("wheat", "flour", "barley", "rye", "breadcrumb", "bread", "pasta", "couscous", "semolina", "soy sauce")),
            Map.entry("sesame", List.of("sesame", "tahini")),
            Map.entry("soy", List.of("soy", "soya", "tofu", "tempeh", "edamame", "miso")),
            Map.entry("soya", List.of("soy", "soya", "tofu", "tempeh", "edamame", "miso")),
            Map.entry("shrimp", List.of("shrimp", "prawn")));

    private final RecipeRepository recipeRepository;
    private final RecommendationService recommendationService;
    private final RecipeMapper recipeMapper;
    @Autowired(required = false)
    private InferenceTransactions inferenceTransactions;
    @Autowired(required=false) private PlanningContextPort tasteContext;

    private <T> T recommendationSnapshot(java.util.function.Supplier<T> action) {
        return inferenceTransactions == null ? action.get() : inferenceTransactions.snapshot(action);
    }
    private <T> T recommendationOutside(java.util.function.Supplier<T> action) {
        return inferenceTransactions == null ? action.get() : inferenceTransactions.outside(action);
    }
    @Autowired
    private RecipeFavouritesRepository favouritesRepository;
    @Autowired
    private RecipeBrowsingHistoryRepository browsingHistoryRepository;
    @Autowired
    private UserAllergyRepository userAllergyRepository;

    @Autowired
    private RecipeDislikedRepository recipeDislikedRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PlatformService platformService;

    private boolean publicDemo() {
        return platformService != null && platformService.publicDemo();
    }

    private static boolean catalogRecipe(Recipe recipe, boolean demo) {
        return recipe.isPublic() && (!demo || (recipe.isDemoPermissionConfirmed()
                && recipe.getDemoPermissionNote() != null && !recipe.getDemoPermissionNote().isBlank()
                && "source".equals(recipe.getImageKind()) && recipe.getImageUrl() != null
                && recipe.getImageUrl().startsWith("/recipe-images/")));
    }

    public boolean isPublicCatalogRecipe(Recipe recipe) {
        return catalogRecipe(recipe, publicDemo());
    }

    /** Resolve the flag once per list; authors retain access to their own recipes. */
    public java.util.function.Predicate<Recipe> catalogVisibility(UUID viewerId) {
        boolean demo = publicDemo();
        return recipe -> (viewerId != null && recipe.getAuthor() != null
                && viewerId.equals(recipe.getAuthor().getId())) || catalogRecipe(recipe, demo);
    }

    private void addCatalogPredicate(CriteriaBuilder cb, Root<Recipe> root, List<Predicate> predicates, boolean demo) {
        if (!demo) return;
        predicates.add(cb.isTrue(root.get("demoPermissionConfirmed")));
        predicates.add(cb.greaterThan(cb.length(cb.trim(cb.coalesce(root.get("demoPermissionNote"), ""))), 0));
        predicates.add(cb.equal(root.get("imageKind"), "source"));
        predicates.add(cb.like(root.get("imageUrl"), "/recipe-images/%"));
    }

    @Value("${recommendation.url}")
    private String recommendationUrl;

    @Autowired
    private RestTemplate restTemplate;

    @Autowired
    public RecipeService(
            RecipeRepository recipeRepository,
            RecommendationService recommendationService,
            RecipeMapper recipeMapper
    ) {
        this.recipeRepository = recipeRepository;
        this.recommendationService = recommendationService;
        this.recipeMapper = recipeMapper;
    }

    @PersistenceContext
    private EntityManager entityManager;

    @Transactional(readOnly = true)
    public Page<RecipeDTO> getAllRecipeDTOs(Pageable pageable) {
        return recipeRepository.findPublicCatalog(publicDemo(), pageable)
                .map(RecipeMapper::toDTO);
    }

    @Transactional(readOnly = true)
    public Page<RecipeDTO> getAllRecipeDTOs(Pageable pageable, Integer maximum) {
        if (maximum == null) return getAllRecipeDTOs(pageable);
        if (maximum < 1 || maximum > 600) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Cooking time must be between 1 and 600 minutes");
        return recipeRepository.findQuickPublicCatalog(publicDemo(), maximum, pageable).map(RecipeMapper::toDTO);
    }

    @Transactional(readOnly = true)
    public Optional<RecipeDTO> getRecipeById(UUID id) {
        return getRecipeById(id, null);
    }

    @Transactional(readOnly = true)
    public Optional<RecipeDTO> getRecipeById(UUID id, UUID viewerId) {
        return recipeRepository.findById(id)
                .filter(catalogVisibility(viewerId))
                .map(RecipeMapper::toDTO);
    }

    @Transactional(readOnly = true)
    public List<RecipeCardDTO> getTopView(Pageable pageable) {
        if (pageable == null) {
            pageable = Pageable.ofSize(20).withPage(0); // Default to first page with 20 items
        }
        return recipeRepository.findTopCatalog(publicDemo(), pageable).stream()
                .map(RecipeMapper::toCardDTO)
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public List<RecipeCardDTO> searchPublicRecipesByAuthorId(UUID authorId) {
        return recipeRepository.findAuthorCatalog(authorId, publicDemo()).stream()
                .map(RecipeMapper::toCardDTO)
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public Page<RecipeCardDTO> advancedSearch(
            String keyword,
            Set<String> cuisines,
            Set<String> ingredients,
            Set<String> allergies,
            Set<String> categories,
            Set<String> dietaryPreferences,
            boolean isPublic,
            Pageable pageable) {
        return advancedSearch(keyword, cuisines, ingredients, allergies, categories, dietaryPreferences,
                isPublic, null, pageable);
    }

    @Transactional(readOnly = true)
    public Page<RecipeCardDTO> advancedSearch(
            String keyword, Set<String> cuisines, Set<String> ingredients, Set<String> allergies,
            Set<String> categories, Set<String> dietaryPreferences, boolean isPublic, UUID viewerId,
            Pageable pageable) {
        return advancedSearch(keyword, cuisines, ingredients, allergies, categories, dietaryPreferences,
                isPublic, null, viewerId, pageable);
    }

    @Transactional(readOnly = true)
    public Page<RecipeCardDTO> advancedSearch(
            String keyword, Set<String> cuisines, Set<String> ingredients, Set<String> allergies,
            Set<String> categories, Set<String> dietaryPreferences, boolean isPublic, Double minRating, UUID viewerId,
            Pageable pageable) {
        if (minRating != null && (!Double.isFinite(minRating) || minRating < 1 || minRating > 5)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Minimum overall rating must be between 1 and 5");
        }
        if (!isPublic && viewerId == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Sign in to search your private recipes");
        }

        CriteriaBuilder cb = entityManager.getCriteriaBuilder();
        CriteriaQuery<Recipe> query = cb.createQuery(Recipe.class);
        Root<Recipe> root = query.from(Recipe.class);

        boolean demo=isPublic&&publicDemo();
        List<Predicate> predicates = searchPredicates(cb,query,root,keyword,cuisines,ingredients,allergies,categories,
                dietaryPreferences,isPublic,viewerId,minRating,demo);
        root.fetch("author",JoinType.LEFT);
        query.select(root).where(predicates.toArray(new Predicate[0]));

        // Sorting
        Map<String, String> sortFieldMap = Map.of(
                "title", "title",
                "createdat", "createdAt",
                "viewcount", "viewCount",
                "cooktime", "cookTime",
                "ratingaverage", "ratingAverage",
                "rating", "ratingAverage"
        );

        if (pageable.getSort().isSorted()) {
            List<Order> orders = new ArrayList<>();
            for (Sort.Order s : pageable.getSort()) {
                String sortKey = s.getProperty().toLowerCase();
                String entityField = sortFieldMap.get(sortKey);
                if (entityField == null) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid sort field: " + sortKey);
                }
                orders.add(s.isAscending() ? cb.asc(root.get(entityField)) : cb.desc(root.get(entityField)));
            }
            orders.add(cb.asc(root.get("id")));
            query.orderBy(orders);
        } else {
            query.orderBy(cb.asc(root.get("id")));
        }

        // Execute query with pagination
        TypedQuery<Recipe> typedQuery = entityManager.createQuery(query);
        typedQuery.setFirstResult((int) pageable.getOffset());
        typedQuery.setMaxResults(pageable.getPageSize());

        List<Recipe> resultList = typedQuery.getResultList();
        List<RecipeCardDTO> results = resultList.stream()
                .map(RecipeMapper::toCardDTO)
                .collect(Collectors.toList());

        // Count total results
        long total = countAdvancedSearchResults(keyword, cuisines, ingredients, allergies, categories,
                dietaryPreferences, isPublic, viewerId, minRating, demo);

        return new PageImpl<>(results, pageable, total);
    }

    private long countAdvancedSearchResults(
            String keyword,
            Set<String> cuisines,
            Set<String> ingredients,
            Set<String> allergies,
            Set<String> categories,
            Set<String> dietaryPreferences,
            boolean isPublic, UUID viewerId, Double minRating, boolean demo) {

        CriteriaBuilder cb=entityManager.getCriteriaBuilder();
        CriteriaQuery<Long> query=cb.createQuery(Long.class);Root<Recipe> root=query.from(Recipe.class);
        List<Predicate> predicates=searchPredicates(cb,query,root,keyword,cuisines,ingredients,allergies,categories,
                dietaryPreferences,isPublic,viewerId,minRating,demo);
        query.select(cb.count(root.get("id"))).where(predicates.toArray(new Predicate[0]));
        return entityManager.createQuery(query).getSingleResult();
    }

    private List<Predicate> searchPredicates(CriteriaBuilder cb,CriteriaQuery<?> query,Root<Recipe> root,
            String keyword,Set<String> cuisines,Set<String> ingredients,Set<String> allergies,Set<String> categories,
            Set<String> dietary,boolean isPublic,UUID viewer,Double minRating,boolean demo){
        List<Predicate> predicates=new ArrayList<>();predicates.add(cb.equal(root.get("isPublic"),isPublic));
        if(!isPublic)predicates.add(cb.equal(root.get("author").get("id"),viewer));
        addCatalogPredicate(cb,root,predicates,demo);
        if(minRating!=null)predicates.add(cb.greaterThanOrEqualTo(root.get("ratingAverage"),minRating));
        if(keyword!=null&&!keyword.isBlank()){
            Join<Recipe,User> author=root.join("author",JoinType.LEFT);
            for(String term:keyword.trim().toLowerCase(Locale.ROOT).split("\\s+")){
                String pattern="%"+escapeLike(term)+"%";
                predicates.add(cb.or(cb.like(cb.lower(root.get("title")),pattern,'\\'),
                    cb.like(cb.lower(root.get("description")),pattern,'\\'),
                    cb.like(cb.lower(author.get("firstName")),pattern,'\\'),cb.like(cb.lower(author.get("lastName")),pattern,'\\')));
            }
        }
        namedRelation(cb,query,root,"categories",categories,false,predicates);
        namedRelation(cb,query,root,"cuisines",cuisines,false,predicates);
        namedRelation(cb,query,root,"dietaryPreferences",dietary,true,predicates);
        addIngredientPredicates(cb,query,root,ingredients,predicates);
        addDietaryContradictionExclusion(cb,query,root,dietary,predicates);
        addAllergenExclusion(cb,query,root,Set.of(),allergies,predicates);return predicates;
    }
    private void namedRelation(CriteriaBuilder cb,CriteriaQuery<?> query,Root<Recipe> root,String relation,
            Set<String> terms,boolean requireAll,List<Predicate> predicates){
        if(terms==null)return;
        List<String> names=terms.stream().filter(Objects::nonNull).map(String::trim).map(v->v.toLowerCase(Locale.ROOT)).filter(v->!v.isBlank()).distinct().toList();
        if(names.isEmpty())return;
        for(List<String> subset:requireAll?names.stream().map(List::of).toList():List.of(names)){
            Subquery<Integer> sub=query.subquery(Integer.class);Root<Recipe> candidate=sub.from(Recipe.class);
            Join<Recipe,?> values=candidate.join(relation);sub.select(cb.literal(1));
            sub.where(cb.equal(candidate.get("id"),root.get("id")),cb.lower(values.get("name")).in(subset));predicates.add(cb.exists(sub));
        }
    }

    private void addIngredientPredicates(CriteriaBuilder cb, CriteriaQuery<?> query, Root<Recipe> recipe,
                                        Set<String> terms, List<Predicate> predicates) {
        if (terms == null) return;
        for (String term : terms.stream().filter(Objects::nonNull).map(String::trim)
                .filter(value -> !value.isEmpty()).map(value -> value.toLowerCase(Locale.ROOT)).distinct().toList()) {
            Subquery<Integer> match = query.subquery(Integer.class);
            Root<RecipeIngredient> item = match.from(RecipeIngredient.class);
            match.select(cb.literal(1)).where(
                    cb.equal(item.get("recipe").get("id"), recipe.get("id")),
                    cb.like(cb.lower(item.get("ingredient").get("name")), "%" + escapeLike(term) + "%", '\\'));
            predicates.add(cb.exists(match));
        }
    }

    private String escapeLike(String term) {
        return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    private Set<String> expandAllergens(Collection<String> terms) {
        Set<String> expanded = new LinkedHashSet<>();
        if (terms == null) return expanded;
        for (String value : terms) {
            if (value == null || value.isBlank()) continue;
            String term = value.trim().toLowerCase(Locale.ROOT);
            expanded.add(term);
            expanded.addAll(ALLERGEN_ALIASES.getOrDefault(term, List.of()));
        }
        return expanded;
    }

    private void addAllergenExclusion(CriteriaBuilder cb, CriteriaQuery<?> query, Root<Recipe> recipe,
                                      Set<UUID> ingredientIds, Collection<String> terms, List<Predicate> predicates) {
        Set<String> names = expandAllergens(terms);
        if (ingredientIds.isEmpty() && names.isEmpty()) return;
        Subquery<Integer> allergen = query.subquery(Integer.class);
        Root<RecipeIngredient> item = allergen.from(RecipeIngredient.class);
        List<Predicate> matches = new ArrayList<>();
        if (!ingredientIds.isEmpty()) matches.add(item.get("ingredient").get("id").in(ingredientIds));
        for (String name : names) matches.add(cb.like(cb.lower(item.get("ingredient").get("name")),
                "%" + escapeLike(name) + "%", '\\'));
        allergen.select(cb.literal(1)).where(cb.equal(item.get("recipe").get("id"), recipe.get("id")),
                cb.or(matches.toArray(new Predicate[0])));
        predicates.add(cb.not(cb.exists(allergen)));
    }

    private void addDietaryContradictionExclusion(CriteriaBuilder cb, CriteriaQuery<?> query, Root<Recipe> recipe,
                                                  Collection<String> diets, List<Predicate> predicates) {
        List<String> patterns=DietaryIngredientGuards.patterns(diets);
        if(patterns.isEmpty())return;
        Subquery<Integer> contradiction=query.subquery(Integer.class);
        Root<RecipeIngredient> item=contradiction.from(RecipeIngredient.class);
        Expression<String> name=cb.lower(cb.coalesce(item.get("ingredient").get("name"),""));
        List<Predicate> matches=patterns.stream().map(regex -> {
            Expression<Boolean> complete=cb.function("regexp_like",Boolean.class,name,cb.literal(regex));
            String necessary=DietaryIngredientGuards.necessaryPattern(regex);
            if(necessary==null)return cb.isTrue(complete);
            Expression<Boolean> cheap=cb.function("regexp_like",Boolean.class,name,cb.literal(necessary));
            // CASE guarantees PostgreSQL evaluates the complete guard only after a term match.
            return cb.isTrue(cb.<Boolean>selectCase().when(cb.isTrue(cheap),complete).otherwise(false));
        }).toList();
        contradiction.select(cb.literal(1)).where(cb.equal(item.get("recipe").get("id"),recipe.get("id")),cb.or(matches.toArray(new Predicate[0])));
        predicates.add(cb.not(cb.exists(contradiction)));
    }

    public Page<RecipeCardDTO> recommendedByRecipeId(UUID recipeId) {
        List<UUID> ids = recommendationOutside(() -> recommendationService.recommendByRecipeId(recipeId, 10));
        return recommendationSnapshot(() -> recommendedRecipeCards(ids));
    }

    private Page<RecipeCardDTO> recommendedRecipeCards(List<UUID> ids) {
        boolean demo = publicDemo();
        Map<UUID, Recipe> visibleRecipes = recipeRepository.findAllWithFullRelationsByIds(ids).stream()
                .filter(recipe -> catalogRecipe(recipe, demo))
                .collect(Collectors.toMap(Recipe::getId, Function.identity()));
        List<RecipeCardDTO> content = ids.stream()
                .map(visibleRecipes::get)
                .filter(Objects::nonNull)
                .map(RecipeMapper::toCardDTO)
                .toList();
        Pageable pageable = PageRequest.of(0, 10);
        return new PageImpl<>(content, pageable, content.size());
    }

    public Page<RecipeCardDTO> recommendedByUserId(UUID userId) {
        RecommendationContext before = recommendationSnapshot(() -> recommendationContext(userId));
        if (before.eligibleIds().isEmpty()) return Page.empty(PageRequest.of(0, 10));
        List<UUID> ranked = recommendationOutside(() -> before.taste().isEmpty()?recommendationService.recommendForUser(before.favorites(),before.history(),before.eligibleIds(),before.excluded(),before.dietary(),100):
                recommendationService.recommendForUser(before.favorites(),before.history(),before.eligibleIds(),before.excluded(),before.dietary(),100,before.taste()));
        return recommendationSnapshot(() -> {
            RecommendationContext current = recommendationContext(userId);
            if (before.demo() != current.demo() || !before.dietary().equals(current.dietary())
                    || !before.allergyIds().equals(current.allergyIds()) || !before.allergyNames().equals(current.allergyNames())
                    || !before.excluded().equals(current.excluded())||!before.taste().equals(current.taste())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Your recipe preferences changed. Refresh recommendations and try again.");
            }
            return personalizedRecipeCards(ranked, current);
        });
    }

    private record RecommendationContext(boolean demo, List<UUID> favorites, List<UUID> history,
            Set<UUID> allergyIds, Set<String> allergyNames, Set<String> dietary, Set<UUID> excluded,
            List<UUID> eligibleIds,Map<String,Object> taste) { }

    private RecommendationContext recommendationContext(UUID userId) {
        boolean demo = publicDemo();
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found"));
        Set<UUID> dislikedIds = new HashSet<>(recipeDislikedRepository.findDislikedRecipeIdsByUserId(userId));
        List<UUID> favIds=favouritesRepository.findRecommendationSeeds(userId,demo,PageRequest.of(0,5));
        List<UUID> historyIds=browsingHistoryRepository.findRecommendationSeeds(userId,demo,PageRequest.of(0,5));

        Set<UUID> allergyIds = new HashSet<>(userAllergyRepository.findAllAllergyIngredientIdsByUserId(userId));
        Set<String> allergyNames = expandAllergens(userAllergyRepository.findAllAllergyIngredientNamesByUserId(userId));
        Set<String> dietary = user.getDietaryPref() == null ? Set.of() : Arrays.stream(user.getDietaryPref())
                .filter(Objects::nonNull).map(this::normalizeDietaryTag).filter(name -> !name.isEmpty())
                .collect(Collectors.toSet());
        Set<UUID> excluded = new HashSet<>(dislikedIds);
        excluded.addAll(favIds);
        excluded.addAll(historyIds);

        // SQL determines eligibility before the ranking response is considered. Popular eligible
        // recipes provide a deterministic refill when many similar candidates fail hard filters.
        List<UUID> eligibleIds = eligibleRecommendationIds(dietary, allergyIds, allergyNames, excluded, demo);
        Map<String,Object> taste=tasteContext==null?Map.of():tasteContext.load(userId,null,false,new PlanningContextPort.Options(false,false,false)).fields();
        return new RecommendationContext(demo, List.copyOf(favIds), List.copyOf(historyIds), Set.copyOf(allergyIds),
                Set.copyOf(allergyNames), Set.copyOf(dietary), Set.copyOf(excluded), List.copyOf(eligibleIds),taste);
    }

    private Page<RecipeCardDTO> personalizedRecipeCards(List<UUID> ranked, RecommendationContext context) {
        boolean demo = context.demo();
        List<UUID> eligibleIds = context.eligibleIds();
        Set<UUID> allergyIds = context.allergyIds();
        Set<String> allergyNames = context.allergyNames();
        Set<String> dietary = context.dietary();
        Set<UUID> excluded = context.excluded();
        Set<UUID> eligible = new HashSet<>(eligibleIds);
        LinkedHashSet<UUID> selected = new LinkedHashSet<>();
        ranked.stream().filter(eligible::contains).limit(10).forEach(selected::add);
        for (UUID id : eligibleIds) {
            if (selected.size() >= 10) break;
            selected.add(id);
        }
        List<UUID> recommendedIds = new ArrayList<>(selected);
        List<Recipe> recommendedRecipes = recipeRepository.findAllWithFullRelationsByIds(recommendedIds);
        Map<UUID, Recipe> idToRecipe = recommendedRecipes.stream()
                .collect(Collectors.toMap(Recipe::getId, Function.identity()));
        List<Recipe> orderedRecipes = recommendedIds.stream()
                .map(idToRecipe::get)
                .filter(Objects::nonNull)
                .toList();
        List<RecipeCardDTO> content = orderedRecipes.stream()
                .filter(recipe -> catalogRecipe(recipe, demo))
                .filter(recipe -> recipe.getDietaryPreferences().stream().map(DietaryPreference::getName)
                        .map(this::normalizeDietaryTag).collect(Collectors.toSet()).containsAll(dietary))
                .filter(recipe -> recipe.getRecipeIngredients().stream()
                        .allMatch(ri -> DietaryIngredientGuards.compatible(ri.getIngredient().getName(), dietary)))
                .filter(recipe -> recipe.getRecipeIngredients().stream()
                        .noneMatch(ri -> allergyIds.contains(ri.getIngredient().getId())
                                || allergyNames.stream().anyMatch(name -> ri.getIngredient().getName()
                                        .toLowerCase(Locale.ROOT).contains(name))))
                .filter(recipe -> !excluded.contains(recipe.getId()))
                .map(RecipeMapper::toCardDTO)
                .limit(10)
                .toList();
        Pageable pageable = PageRequest.of(0, content.size() == 0 ? 1 : content.size());
        return new PageImpl<>(content, pageable, content.size());
    }

    private String normalizeDietaryTag(String name) {
        return name.trim().toLowerCase(Locale.ROOT).replace("-", "").replace(" ", "");
    }

    private boolean visibleToUser(Recipe recipe, UUID userId, boolean demo) {
        return recipe.isPublic() ? catalogRecipe(recipe, demo)
                : recipe.getAuthor() != null && userId.equals(recipe.getAuthor().getId());
    }

    private List<UUID> eligibleRecommendationIds(Set<String> dietary, Set<UUID> allergies,
                                                  Set<String> allergyNames, Set<UUID> excluded, boolean demo) {
        CriteriaBuilder cb = entityManager.getCriteriaBuilder();
        CriteriaQuery<UUID> query = cb.createQuery(UUID.class);
        Root<Recipe> root = query.from(Recipe.class);
        List<Predicate> predicates = new ArrayList<>();
        predicates.add(cb.isTrue(root.get("isPublic")));
        addCatalogPredicate(cb, root, predicates, demo);
        if (!excluded.isEmpty()) predicates.add(cb.not(root.get("id").in(excluded)));
        for (String tag : dietary) {
            Subquery<Integer> match = query.subquery(Integer.class);
            Root<Recipe> candidate = match.from(Recipe.class);
            Join<Recipe, DietaryPreference> preference = candidate.join("dietaryPreferences");
            Expression<String> normalizedName = cb.function("replace", String.class,
                    cb.function("replace", String.class, cb.lower(preference.get("name")), cb.literal("-"), cb.literal("")),
                    cb.literal(" "), cb.literal(""));
            match.select(cb.literal(1)).where(cb.equal(candidate.get("id"), root.get("id")),
                    cb.equal(normalizedName, tag));
            predicates.add(cb.exists(match));
        }
        addDietaryContradictionExclusion(cb, query, root, dietary, predicates);
        addAllergenExclusion(cb, query, root, allergies, allergyNames, predicates);
        query.select(root.get("id")).where(predicates.toArray(new Predicate[0]))
                .orderBy(cb.desc(root.get("viewCount")), cb.desc(root.get("createdAt")), cb.asc(root.get("id")));
        return entityManager.createQuery(query).getResultList();
    }

    @Transactional(readOnly = true)
    public List<RecipeDTO> getAllRecipesWithFullRelations() {
        boolean demo = publicDemo();
        CriteriaBuilder cb = entityManager.getCriteriaBuilder();
        CriteriaQuery<UUID> query = cb.createQuery(UUID.class);
        Root<Recipe> root = query.from(Recipe.class);
        List<Predicate> predicates = new ArrayList<>();
        predicates.add(cb.isTrue(root.get("isPublic")));
        addCatalogPredicate(cb, root, predicates, demo);
        query.select(root.get("id")).where(predicates.toArray(new Predicate[0])).orderBy(cb.asc(root.get("id")));
        // Bound IDs in SQL before the full ingredient/tag joins, preserving the legacy list shape.
        List<UUID> ids = entityManager.createQuery(query).setMaxResults(100).getResultList();
        if (ids.isEmpty()) return List.of();
        Map<UUID, Recipe> fetched = recipeRepository.findAllWithFullRelationsByIds(ids).stream()
                .collect(Collectors.toMap(Recipe::getId, Function.identity()));
        return ids.stream().map(fetched::get).filter(Objects::nonNull)
                .filter(recipe -> catalogRecipe(recipe, demo))
                .map(RecipeMapper::toDTO)
                .toList();
    }
}
